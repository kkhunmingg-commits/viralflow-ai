"""Small, strict HTTP surface for the installed Windows agent."""

from __future__ import annotations

import json
import re
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from .agent import AgentError, LocalAgent, MAX_REFERENCE_BYTES

MAX_JSON_BYTES = 32 * 1024
MAX_CONCURRENT_CLIENTS = 16
SOCKET_TIMEOUT_SECONDS = 5
BODY_DEADLINE_SECONDS = 10
SESSION_ROUTE = re.compile(r"^/v1/sessions/([0-9a-fA-F-]{36})/(pause|resume|stop|recover)$")
FRAME_ROUTE = re.compile(r"^/v1/sessions/([0-9a-fA-F-]{36})/frame$")


class AgentHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, agent: LocalAgent, *, port: int = 8766):
        if not isinstance(port, int) or not 0 <= port <= 65535:
            raise ValueError("Invalid agent port")
        self.agent = agent
        self._client_slots = threading.BoundedSemaphore(MAX_CONCURRENT_CLIENTS)
        super().__init__(("127.0.0.1", port), _Handler)
        self.expected_host = f"127.0.0.1:{self.server_port}"

    def get_request(self):
        request, address = super().get_request()
        request.settimeout(SOCKET_TIMEOUT_SECONDS)
        return request, address

    def process_request(self, request, client_address):
        if not self._client_slots.acquire(blocking=False):
            try:
                request.sendall(
                    b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n"
                    b"Cache-Control: no-store\r\nConnection: close\r\n\r\n"
                )
            except OSError:
                pass
            finally:
                self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self._client_slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._client_slots.release()

    def close_agent(self) -> None:
        self.shutdown()
        self.server_close()
        self.agent.close()


class _Handler(BaseHTTPRequestHandler):
    server: AgentHTTPServer
    protocol_version = "HTTP/1.1"

    def log_message(self, _format: str, *_args: Any) -> None:
        # Do not log headers, one-time pairing codes, bearer tokens, or paths.
        pass

    def _origin(self) -> str:
        origin = self.headers.get("Origin", "")
        if origin not in self.server.agent.config.allowed_origins:
            raise AgentError(403, "ORIGIN_DENIED", "ไม่อนุญาตให้เชื่อมต่อจากหน้านี้")
        return origin

    def _validate_request(self) -> str:
        if self.client_address[0] != "127.0.0.1":
            raise AgentError(403, "LOOPBACK_ONLY", "อนุญาตให้เชื่อมต่อจากเครื่องนี้เท่านั้น")
        if len(self.headers.get_all("Host", [])) != 1 or len(self.headers.get_all("Origin", [])) != 1:
            raise AgentError(403, "HOST_DENIED", "ไม่อนุญาตให้เชื่อมต่อจากที่อยู่นี้")
        if self.headers.get("Host", "") != self.server.expected_host:
            raise AgentError(403, "HOST_DENIED", "ไม่อนุญาตให้เชื่อมต่อจากที่อยู่นี้")
        if "?" in self.path or "#" in self.path or "%" in self.path:
            raise AgentError(404, "NOT_FOUND", "ไม่พบคำสั่ง")
        return self._origin()

    def _token(self, origin: str) -> str:
        if len(self.headers.get_all("Authorization", [])) != 1:
            raise AgentError(401, "LOCAL_AUTH_REQUIRED", "กรุณาเชื่อมต่อเครื่องนี้อีกครั้ง")
        authorization = self.headers.get("Authorization", "")
        if not authorization.startswith("Bearer ") or len(authorization) > 256:
            raise AgentError(401, "LOCAL_AUTH_REQUIRED", "กรุณาเชื่อมต่อเครื่องนี้อีกครั้ง")
        token = authorization[7:]
        if not token or " " in token:
            raise AgentError(401, "LOCAL_AUTH_REQUIRED", "กรุณาเชื่อมต่อเครื่องนี้อีกครั้ง")
        self.server.agent.authenticate(token, origin)
        return token

    def _read_body(self, limit: int) -> bytes:
        if self.headers.get("Transfer-Encoding"):
            raise AgentError(400, "INVALID_BODY", "ข้อมูลไม่ถูกต้อง")
        length = self.headers.get("Content-Length")
        try:
            size = int(length) if length is not None else -1
        except ValueError as exc:
            raise AgentError(400, "INVALID_BODY", "ข้อมูลไม่ถูกต้อง") from exc
        if size < 0 or size > limit:
            raise AgentError(413 if size > limit else 411, "INVALID_BODY_SIZE", "ข้อมูลมีขนาดไม่ถูกต้อง")
        body = bytearray()
        deadline = time.monotonic() + BODY_DEADLINE_SECONDS
        while len(body) < size:
            remaining_seconds = deadline - time.monotonic()
            if remaining_seconds <= 0:
                raise AgentError(408, "BODY_TIMEOUT", "หมดเวลารับข้อมูล")
            self.connection.settimeout(min(SOCKET_TIMEOUT_SECONDS, remaining_seconds))
            try:
                chunk = self.rfile.read1(min(65_536, size - len(body)))
            except (TimeoutError, OSError) as exc:
                raise AgentError(408, "BODY_TIMEOUT", "หมดเวลารับข้อมูล") from exc
            if not chunk:
                raise AgentError(400, "INVALID_BODY", "ข้อมูลไม่ถูกต้อง")
            body.extend(chunk)
        return bytes(body)

    def _json_body(self) -> dict[str, object]:
        if self.headers.get("Content-Type", "").split(";")[0].strip().lower() != "application/json":
            raise AgentError(415, "INVALID_CONTENT_TYPE", "ข้อมูลไม่ถูกต้อง")
        try:
            value = json.loads(self._read_body(MAX_JSON_BYTES))
        except (UnicodeDecodeError, ValueError) as exc:
            raise AgentError(400, "INVALID_JSON", "ข้อมูลไม่ถูกต้อง") from exc
        if not isinstance(value, dict):
            raise AgentError(400, "INVALID_JSON", "ข้อมูลไม่ถูกต้อง")
        return value

    def _send_json(self, status: int, data: dict[str, object], origin: str | None = None) -> None:
        body = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Vary", "Origin")
        if origin in self.server.agent.config.allowed_origins:
            self.send_header("Access-Control-Allow-Origin", origin)
        self.end_headers()
        self.wfile.write(body)
        self.close_connection = True

    def _dispatch(self, method: str) -> None:
        origin: str | None = None
        try:
            origin = self._validate_request()
            agent = self.server.agent
            if method == "OPTIONS":
                if self.headers.get("Access-Control-Request-Method") not in ("GET", "POST"):
                    raise AgentError(403, "PREFLIGHT_DENIED", "ไม่อนุญาตให้เชื่อมต่อ")
                requested = self.headers.get("Access-Control-Request-Headers", "")
                if any(header.strip().lower() not in ("authorization", "content-type")
                       for header in requested.split(",") if header.strip()):
                    raise AgentError(403, "PREFLIGHT_DENIED", "ไม่อนุญาตให้เชื่อมต่อ")
                self.send_response(204)
                self.send_header("Content-Length", "0")
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
                self.send_header("Access-Control-Allow-Private-Network", "true")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Vary", "Origin")
                self.end_headers()
                return
            if method == "GET" and self.path == "/v1/discovery":
                self._send_json(200, agent.discovery(), origin)
                return
            if method == "POST" and self.path == "/v1/pair":
                body = self._json_body()
                if set(body) != {"code"} or not isinstance(body["code"], str):
                    raise AgentError(400, "INVALID_PAIRING_REQUEST", "ข้อมูลไม่ถูกต้อง")
                self._send_json(200, agent.pair(body["code"], origin), origin)
                return
            token = self._token(origin)
            if method == "GET" and self.path == "/v1/challenge":
                self._send_json(200, agent.challenge(token, origin), origin)
            elif method == "POST" and self.path == "/v1/renew":
                self._send_json(200, agent.renew(token, origin), origin)
            elif method == "GET" and self.path == "/v1/status":
                self._send_json(200, agent.status(token, origin), origin)
            elif method == "GET" and self.path == "/v1/hardware":
                self._send_json(200, agent.hardware(token, origin), origin)
            elif method == "GET" and self.path == "/v1/components/status":
                self._send_json(200, agent.components_status(token, origin)["components"], origin)
            elif method == "POST" and self.path == "/v1/components/prepare":
                request = self._json_body()
                if set(request) != {"grant", "repair"} or type(request["repair"]) is not bool:
                    raise AgentError(400, "INVALID_PREPARATION_REQUEST", "ข้อมูลไม่ถูกต้อง")
                self._send_json(202, agent.prepare_components(token, origin, request["grant"], repair=request["repair"])["components"], origin)
            elif method == "GET" and (match := FRAME_ROUTE.fullmatch(self.path)):
                frame = agent.preview_frame(token, origin, match.group(1))
                self.send_response(200 if frame else 204)
                self.send_header("Content-Type", "image/jpeg")
                self.send_header("Content-Length", str(len(frame) if frame else 0))
                self.send_header("Cache-Control", "no-store")
                self.send_header("Connection", "close")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
                self.end_headers()
                if frame:
                    self.wfile.write(frame)
                self.close_connection = True
            elif method == "POST" and self.path == "/v1/stream/setup":
                request = self._json_body()
                if set(request) != {"grant"}:
                    raise AgentError(400, "INVALID_SETUP_REQUEST", "ข้อมูลไม่ถูกต้อง")
                self._send_json(202, agent.request_stream_setup(token, origin, request["grant"]), origin)
            elif method == "POST" and self.path == "/v1/updates/check":
                request = self._json_body()
                if set(request) != {"manifest"}:
                    raise AgentError(400, "INVALID_UPDATE_REQUEST", "ข้อมูลไม่ถูกต้อง")
                self._send_json(200, agent.check_update(token, origin, request["manifest"]), origin)
            elif method == "POST" and self.path in ("/v1/updates/apply", "/v1/updates/repair"):
                request = self._json_body()
                if set(request) != {"confirmed"} or request["confirmed"] is not True:
                    raise AgentError(400, "UPDATE_CONFIRMATION_REQUIRED", "กรุณายืนยันการอัปเดต")
                self._send_json(202, agent.apply_update(token, origin, confirmed=True,
                                                      repair=self.path == "/v1/updates/repair"), origin)
            elif method == "POST" and self.path == "/v1/device/proof":
                request = self._json_body()
                if set(request) != {"challenge"}:
                    raise AgentError(400, "INVALID_DEVICE_REQUEST", "ข้อมูลไม่ถูกต้อง")
                self._send_json(200, agent.device_proof(token, origin, request["challenge"]), origin)
            elif method == "POST" and self.path == "/v1/device/certificate":
                request = self._json_body()
                if set(request) != {"certificate"}:
                    raise AgentError(400, "INVALID_DEVICE_REQUEST", "ข้อมูลไม่ถูกต้อง")
                self._send_json(200, agent.install_certificate(token, origin, request["certificate"]), origin)
            elif method == "POST" and self.path == "/v1/device/revoke":
                request = self._json_body()
                if set(request) != {"receipt"}:
                    raise AgentError(400, "INVALID_DEVICE_REQUEST", "ข้อมูลไม่ถูกต้อง")
                self._send_json(200, agent.revoke_device(token, origin, request["receipt"]), origin)
            elif method == "POST" and self.path == "/v1/references":
                media_type = self.headers.get("Content-Type", "").split(";")[0].strip().lower()
                body = self._read_body(MAX_REFERENCE_BYTES)
                self._send_json(201, agent.upload_reference(token, origin, body, media_type), origin)
            elif method == "POST" and self.path == "/v1/sessions/start":
                request = self._json_body()
                if set(request) != {"grant", "accountId", "productIds", "presenterId", "microphoneId"}:
                    raise AgentError(400, "INVALID_START_REQUEST", "ข้อมูลไม่ถูกต้อง")
                self._send_json(200, agent.start(token, origin, request), origin)
            elif method == "POST" and (match := SESSION_ROUTE.fullmatch(self.path)):
                session_id = match.group(1)
                try:
                    if str(uuid.UUID(session_id)) != session_id.lower():
                        raise ValueError
                except ValueError as exc:
                    raise AgentError(404, "NOT_FOUND", "ไม่พบคำสั่ง") from exc
                action = match.group(2)
                result = getattr(agent, action)(token, origin, session_id)
                self._send_json(200, result, origin)
            else:
                raise AgentError(404, "NOT_FOUND", "ไม่พบคำสั่ง")
        except AgentError as exc:
            self._send_json(exc.status, {"code": exc.code, "message": exc.message}, origin)
        except Exception:
            self._send_json(500, {"code": "AGENT_ERROR", "message": "ไม่สามารถเชื่อมต่อ AI LIVE"}, origin)

    def do_OPTIONS(self) -> None:
        self._dispatch("OPTIONS")

    def do_GET(self) -> None:
        self._dispatch("GET")

    def do_POST(self) -> None:
        self._dispatch("POST")


def serve_agent(agent: LocalAgent, *, port: int = 8766,
                stop_event: threading.Event | None = None) -> None:
    server = AgentHTTPServer(agent, port=port)
    try:
        if stop_event is None:
            server.serve_forever(poll_interval=0.2)
        else:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            stop_event.wait()
            server.shutdown()
            thread.join(timeout=5)
    finally:
        server.server_close()
        agent.close()
