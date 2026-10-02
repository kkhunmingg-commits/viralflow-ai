"""DEV receiver player: play incoming RTMP bytes, never a completed MP4.

Only the opt-in direct proof creates this loopback server. No cloud credentials,
platform APIs, arbitrary paths, or production LIVE readiness are exposed.
"""
from __future__ import annotations

import collections
import json
import math
import os
import socket
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs

from direct_stream import LocalRTMPReceiver


PAGE = '''<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ViralFlow — Local receiver proof</title><style>body{background:#10131d;color:#edf0ff;font:16px system-ui;margin:0;padding:30px}main{max-width:760px;margin:auto}video{width:100%;max-width:540px;border-radius:20px;background:#171c28}button{background:#7160ed;color:white;padding:14px 24px;border:0;border-radius:12px;font:inherit}p{color:#b8c3d9}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style>
<main><h1>ViralFlow · ทดสอบภาพและเสียงในเครื่อง</h1><p>ภาพและเสียงจาก receiver ระหว่างส่งจริง — ไม่ได้ไลฟ์ไป TikTok</p><video id="player" controls autoplay muted playsinline></video><p><button id="sound">เปิดเสียงและเล่น</button></p><p id="state">กำลังเชื่อมต่อ</p><pre id="metrics"></pre></main>
<script>
const video=document.querySelector('#player'), state=document.querySelector('#state');
let generation=-1, source, buffer, sequence=0, busy=false, errors=0, sound=false, audio, analyser, audioInput;
const queue=[]; let mime='', callbacks=0;
if(video.requestVideoFrameCallback){const tick=()=>{callbacks++;video.requestVideoFrameCallback(tick)};video.requestVideoFrameCallback(tick)}
document.querySelector('#sound').onclick=async()=>{try{sound=true;video.muted=false;if(!audio){audio=new AudioContext();analyser=audio.createAnalyser();audioInput=audio.createMediaElementSource(video);audioInput.connect(analyser);analyser.connect(audio.destination)}await audio.resume();await video.play()}catch{state.textContent='กรุณากดเล่นอีกครั้ง'}};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function flush(){if(!buffer||buffer.updating||!queue.length)return;try{buffer.appendBuffer(queue.shift())}catch{errors++;queue.length=0;generation=-1}}
async function reset(info){queue.length=0;buffer=null;generation=info.generation;sequence=info.first_sequence;mime=info.mime;
  if(source){try{URL.revokeObjectURL(video.src)}catch{}}
  source=new MediaSource();video.src=URL.createObjectURL(source);
  await new Promise(resolve=>source.addEventListener('sourceopen',resolve,{once:true}));
  if(!MediaSource.isTypeSupported(mime))throw Error('Unsupported media');
  buffer=source.addSourceBuffer(mime);buffer.addEventListener('error',()=>{errors++;generation=-1});
  buffer.addEventListener('updateend',()=>{if(video.buffered.length&&video.currentTime<video.buffered.start(0))video.currentTime=video.buffered.start(0);if(!queue.length&&video.currentTime>12&&buffer.buffered.length&&buffer.buffered.start(0)<video.currentTime-10){try{buffer.remove(0,video.currentTime-8);return}catch{}}flush()});
  queue.push(await(await fetch('/init?generation='+generation,{cache:'no-store'})).arrayBuffer());flush();
  video.play().catch(()=>{});
}
async function poll(){try{const info=await(await fetch('/status',{cache:'no-store'})).json();
  if(info.ready){if(info.generation!==generation)await reset(info);
    if(sequence<info.first_sequence){generation=-1;return}
    while(sequence<=info.last_sequence&&queue.length<12){const response=await fetch('/fragment?generation='+generation+'&sequence='+sequence,{cache:'no-store'});if(!response.ok){generation=-1;break}queue.push(await response.arrayBuffer());sequence++;flush()}
    state.textContent=video.paused?'พร้อมเล่น':video.readyState>=3?'กำลัง LIVE ในเครื่อง':'กำลังเชื่อมต่อ';
  }else state.textContent='กำลังเตรียมภาพและเสียง';
}catch{state.textContent='เชื่อมต่อใหม่'}finally{setTimeout(poll,150)}}
setInterval(()=>{let rms=0;if(analyser&&audio?.state==='running'){const values=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(values);rms=Math.sqrt(values.reduce((n,x)=>n+x*x,0)/values.length)}
  const status={generation,currentTime:video.currentTime,decodedVideoFrames:video.webkitDecodedFrameCount||callbacks,audioDecodedBytes:video.webkitAudioDecodedByteCount||0,readyState:video.readyState,playing:!video.paused&&!video.ended,soundEnabled:sound&&!video.muted,audioRms:rms,errors};
  document.querySelector('#metrics').textContent=JSON.stringify(status,null,2);
  fetch('/observations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(status)}).catch(()=>{});
},1000);poll();
</script></html>'''.encode()


class _PlayerHTTPServer(ThreadingHTTPServer):
    MAX_CLIENTS = 8
    CLIENT_TIMEOUT_SECONDS = 2.0
    daemon_threads = True

    def __init__(self, *args, **kwargs):
        self._client_slots = threading.BoundedSemaphore(self.MAX_CLIENTS)
        self._clients_lock = threading.Lock()
        self._clients = {}
        self._closing = False
        super().__init__(*args, **kwargs)

    def process_request(self, request, client_address):
        request.settimeout(self.CLIENT_TIMEOUT_SECONDS)
        if not self._client_slots.acquire(blocking=False):
            # The accept loop never waits for a client slot or an unbounded write.
            try:
                request.settimeout(.05)
                request.sendall(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            except OSError:
                pass
            finally:
                self.shutdown_request(request)
            return
        with self._clients_lock:
            if self._closing:
                self._client_slots.release()
                self.shutdown_request(request)
                return
            thread = threading.Thread(target=self.process_request_thread, args=(request, client_address),
                                      name="proof-player-client", daemon=True)
            self._clients[request] = thread
            try:
                thread.start()
            except Exception:
                self._clients.pop(request, None)
                self._client_slots.release()
                self.shutdown_request(request)
                raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            with self._clients_lock:
                self._clients.pop(request, None)
            self._client_slots.release()

    def server_close(self):
        with self._clients_lock:
            self._closing = True
            clients = list(self._clients.items())
        # Closing the listening socket alone leaves partial request reads alive.
        for request, _thread in clients:
            try:
                request.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            request.close()
        super().server_close()
        deadline = time.monotonic() + self.CLIENT_TIMEOUT_SECONDS
        for _request, thread in clients:
            thread.join(timeout=max(0, deadline - time.monotonic()))
        if any(thread.is_alive() for _request, thread in clients):
            raise RuntimeError("PLAYER_REQUESTS_STOP_PENDING")


class ReceiverPlayer:
    MAX_BOX_BYTES = 8 * 1024 * 1024
    MAX_CACHE_BYTES = 4 * 1024 * 1024

    def __init__(self, port: int):
        if not 1024 <= port <= 65535:
            raise ValueError("INVALID_PLAYER_PORT")
        self.port = port
        self._lock = threading.RLock()
        self.generation = 0
        self._init = b""
        self._fragments = collections.deque(maxlen=32)
        self._parser = bytearray()
        self._pending = bytearray()
        self._sequence = 0
        self.fragments_received = 0
        self.max_cache_bytes = 0
        self.observations = collections.deque(maxlen=750)
        self._server = None
        self._thread = None

    def new_connection(self) -> int:
        with self._lock:
            self.generation += 1
            self._init = b""
            self._fragments.clear()
            self._parser.clear()
            self._pending.clear()
            self._sequence = 0
            return self.generation

    def accept(self, generation: int, data: bytes) -> None:
        with self._lock:
            if generation != self.generation:
                return
            self._parser.extend(data)
            if len(self._parser) > self.MAX_BOX_BYTES:
                raise ValueError("PLAYER_BOX_TOO_LARGE")
            while len(self._parser) >= 8:
                length = int.from_bytes(self._parser[:4], "big")
                if not 8 <= length <= self.MAX_BOX_BYTES:
                    raise ValueError("PLAYER_BOX_INVALID")
                if len(self._parser) < length:
                    break
                kind = bytes(self._parser[4:8])
                box = bytes(self._parser[:length])
                del self._parser[:length]
                if kind in (b"ftyp", b"moov"):
                    self._init += box
                    if len(self._init) > 256 * 1024:
                        raise ValueError("PLAYER_INIT_TOO_LARGE")
                elif kind == b"moof":
                    self._pending = bytearray(box)
                elif kind == b"mdat" and self._pending:
                    self._pending.extend(box)
                    if len(self._pending) > self.MAX_CACHE_BYTES:
                        raise ValueError("PLAYER_FRAGMENT_TOO_LARGE")
                    self._sequence += 1
                    self.fragments_received += 1
                    self._fragments.append((self._sequence, bytes(self._pending)))
                    self._pending.clear()
                    total = sum(len(part) for _, part in self._fragments)
                    while total > self.MAX_CACHE_BYTES:
                        total -= len(self._fragments.popleft()[1])
                    self.max_cache_bytes = max(self.max_cache_bytes, total)

    def status(self) -> dict:
        with self._lock:
            avcc = self._init.find(b"avcC")
            mime = ('video/mp4; codecs="avc1.' + self._init[avcc + 5:avcc + 8].hex() + ',mp4a.40.2"') if avcc >= 0 else ""
            return {"generation": self.generation, "ready": bool(mime and b"mp4a" in self._init and self._fragments),
                    "mime": mime, "first_sequence": self._fragments[0][0] if self._fragments else 0,
                    "last_sequence": self._fragments[-1][0] if self._fragments else 0}

    def record(self, value: object) -> None:
        fields = {"generation", "currentTime", "decodedVideoFrames", "audioDecodedBytes", "readyState", "playing", "soundEnabled", "audioRms", "errors"}
        if not isinstance(value, dict) or set(value) != fields:
            raise ValueError("PLAYER_OBSERVATION_INVALID")
        numeric = fields - {"playing", "soundEnabled"}
        if any(type(value[key]) not in (int, float) or not math.isfinite(value[key]) or not 0 <= value[key] <= 10**12 for key in numeric):
            raise ValueError("PLAYER_OBSERVATION_INVALID")
        if any(type(value[key]) is not bool for key in ("playing", "soundEnabled")):
            raise ValueError("PLAYER_OBSERVATION_INVALID")
        with self._lock:
            if value["generation"] != self.generation:
                raise ValueError("PLAYER_OBSERVATION_STALE")
            self.observations.append(dict(value))

    def evidence(self) -> dict:
        with self._lock:
            return {"fragments_received": self.fragments_received, "max_cache_bytes": self.max_cache_bytes,
                    "observations": list(self.observations), "source": "RECEIVER_LIVE_FRAGMENTED_MP4"}

    def start(self) -> None:
        player = self
        host = f"127.0.0.1:{self.port}"
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args): pass
            def _allowed(self) -> bool:
                return self.headers.get("Host") == host and self.headers.get("Origin") in (None, "http://" + host)
            def _reply(self, status: int, body: bytes, media: str = "application/json"):
                try:
                    self.send_response(status)
                    self.send_header("Content-Type", media)
                    self.send_header("Content-Length", str(len(body)))
                    self.send_header("Cache-Control", "no-store")
                    self.send_header("X-Content-Type-Options", "nosniff")
                    self.end_headers()
                    self.wfile.write(body)
                except OSError:
                    self.close_connection = True
            def do_GET(self):
                if not self._allowed(): self._reply(403, b"{}"); return
                parsed = urlsplit(self.path)
                if parsed.path == "/": self._reply(200, PAGE, "text/html; charset=utf-8"); return
                if parsed.path == "/status": self._reply(200, json.dumps(player.status()).encode()); return
                query = parse_qs(parsed.query)
                with player._lock:
                    if query.get("generation") != [str(player.generation)]:
                        response = (410, b"{}")
                    elif parsed.path == "/init":
                        response = (200, player._init, "video/mp4")
                    elif parsed.path == "/fragment":
                        try: sequence = int(query.get("sequence", [""])[0])
                        except ValueError:
                            response = (400, b"{}")
                        else:
                            body = next((part for index, part in player._fragments if index == sequence), None)
                            response = (200 if body else 410, body or b"{}", "video/mp4")
                    else:
                        response = (404, b"{}")
                # Cached bytes are immutable. A slow browser must not hold the
                # parser/evidence lock while socket writes wait for its reader.
                self._reply(*response)
            def do_POST(self):
                if not self._allowed() or self.path != "/observations" or self.headers.get("Content-Type") != "application/json": self._reply(403, b"{}"); return
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                    if not 0 < length <= 4096: raise ValueError
                    body = self.rfile.read(length)
                    if len(body) != length: raise ValueError
                    player.record(json.loads(body))
                except (ValueError, TypeError): self._reply(400, b"{}"); return
                except OSError: self._reply(408, b"{}"); return
                self._reply(200, b"{}")
        self._server = _PlayerHTTPServer(("127.0.0.1", self.port), Handler)
        self._thread = threading.Thread(target=self._server.serve_forever, name="proof-receiver-player", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        if self._server:
            try:
                if self._thread and self._thread.is_alive():
                    self._server.shutdown()
            finally:
                self._server.server_close()
        if self._thread and self._thread.ident is not None:
            self._thread.join(timeout=2)


class PlayingRTMPReceiver(LocalRTMPReceiver):
    def __init__(self, *args, player: ReceiverPlayer, **kwargs):
        super().__init__(*args, **kwargs)
        self.player = player
        self._reader = None
        self.player_error = False

    def start(self) -> None:
        self.output.parent.mkdir(parents=True, exist_ok=True)
        generation = self.player.new_connection()
        self.process = subprocess.Popen([self._ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
            "-listen", "1", "-analyzeduration", "0", "-probesize", "32768", "-i", self._url,
            "-map", "0:v:0", "-map", "0:a:0", "-c", "copy", "-flush_packets", "1", "-f", "flv", str(self.output),
            "-map", "0:v:0", "-map", "0:a:0", "-c", "copy", "-movflags", "frag_keyframe+empty_moov+default_base_moof",
            "-frag_duration", "500000", "-flush_packets", "1", "-f", "mp4", "pipe:1"],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, shell=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        process = self.process
        def drain():
            try:
                while data := process.stdout.read1(65536):
                    self.player.accept(generation, data)
            except (OSError, ValueError):
                self.player_error = True
        self._reader = threading.Thread(target=drain, name="proof-receiver-playback", daemon=True)
        self._reader.start()

    def stop(self) -> None:
        super().stop()
        if self._reader:
            self._reader.join(timeout=3)
        if self.process and self.process.stdout:
            self.process.stdout.close()

    def metrics(self) -> dict:
        return {**super().metrics(), "player_ready": self.player.status()["ready"], "player_error": self.player_error}
