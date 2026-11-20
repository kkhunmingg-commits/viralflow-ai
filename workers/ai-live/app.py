"""Authenticated loopback API for a genuinely incremental live presenter."""

from __future__ import annotations

import hmac
import os
import tempfile
import uuid
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse, Response
from pydantic import BaseModel, Field

from capabilities import inspect_capabilities
from engine import make_engine
from provider_config import dev_fallback_enabled, selected_provider
from worker_core import LiveError, LiveStore, MAX_AUDIO_BYTES, MAX_REFERENCE_BYTES


class StartRequest(BaseModel):
    reference_id: uuid.UUID
    target_fps: int = Field(default=25, ge=1, le=30)


def create_app(token: str | None = None, data_dir: Path | None = None,
               *, store: LiveStore | None = None) -> FastAPI:
    secret = token if token is not None else os.getenv("AI_LIVE_WORKER_TOKEN", "")
    if not secret or len(secret) < 32:
        raise RuntimeError("AI_LIVE_WORKER_TOKEN must contain at least 32 characters")
    store = store or LiveStore(data_dir or Path(tempfile.gettempdir()) / "viralflow-ai-live")
    @asynccontextmanager
    async def lifespan(_api: FastAPI):
        try:
            yield
        finally:
            store.close()

    api = FastAPI(title="ViralFlow AI LIVE local worker", docs_url=None, redoc_url=None, lifespan=lifespan)
    api.state.store = store

    @api.exception_handler(LiveError)
    async def live_error(_request: Request, exc: LiveError) -> JSONResponse:
        return JSONResponse(status_code=exc.status, content={"code": exc.code, "detail": exc.detail})

    def authenticate(
        authorization: str | None = Header(default=None),
        x_viralflow_owner_id: str | None = Header(default=None),
    ) -> str:
        expected = f"Bearer {secret}"
        if not authorization or not hmac.compare_digest(authorization, expected):
            raise HTTPException(status_code=401, detail="Worker authentication required")
        try:
            return str(uuid.UUID(x_viralflow_owner_id or ""))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Valid owner ID required") from exc

    async def bounded_body(request: Request, limit: int) -> bytes:
        length = request.headers.get("content-length")
        if length:
            try:
                if int(length) > limit:
                    raise LiveError(413, "PAYLOAD_TOO_LARGE", "Upload exceeds the allowed size")
            except ValueError as exc:
                raise LiveError(400, "INVALID_LENGTH", "Invalid Content-Length") from exc
        buffer = bytearray()
        async for chunk in request.stream():
            buffer.extend(chunk)
            if len(buffer) > limit:
                raise LiveError(413, "PAYLOAD_TOO_LARGE", "Upload exceeds the allowed size")
        return bytes(buffer)

    @api.get("/health")
    def health(_owner: str = Depends(authenticate)) -> dict:
        return inspect_capabilities()

    @api.post("/references", status_code=201)
    async def upload_reference(
        request: Request, owner: str = Depends(authenticate)
    ) -> dict[str, str]:
        media_type = request.headers.get("content-type", "").split(";")[0].lower()
        image = await bounded_body(request, MAX_REFERENCE_BYTES)
        reference_id = store.save_reference(owner, image, media_type)
        return {"reference_id": reference_id, "status": "STORED"}

    @api.post("/sessions", status_code=201)
    def start_presenter(body: StartRequest, owner: str = Depends(authenticate)) -> dict:
        reference_id = str(body.reference_id)
        store.get_reference(owner, reference_id)
        capability = inspect_capabilities()
        try:
            selected_provider()
        except RuntimeError as exc:
            raise LiveError(503, str(exc), "Requested presenter provider is disabled") from exc
        if capability.get("presenter_status") == "GPU_REQUIRED":
            raise LiveError(503, "GPU_REQUIRED", "NVIDIA CUDA runtime is unavailable")
        if not capability["ready"]:
            raise LiveError(503, "PRESENTER_UNAVAILABLE", "; ".join(capability["blockers"]))
        try:
            engine = make_engine()
        except (ImportError, RuntimeError, AttributeError) as exc:
            raise LiveError(503, "PRESENTER_UNAVAILABLE", "Presenter streaming backend unavailable") from exc
        target_fps = body.target_fps
        if dev_fallback_enabled():
            target_fps = min(body.target_fps, 5) if "target_fps" in body.model_fields_set else 2
        session_id, session = store.start_session(owner, reference_id, target_fps, engine)
        return {"session_id": session_id, "status": session.status}

    @api.post("/sessions/{session_id}/audio")
    async def send_audio(
        session_id: uuid.UUID, request: Request, owner: str = Depends(authenticate)
    ) -> dict:
        if request.headers.get("content-type", "").split(";")[0].lower() != "application/octet-stream":
            raise LiveError(415, "INVALID_AUDIO_TYPE", "Send raw PCM16 as application/octet-stream")
        pcm = await bounded_body(request, MAX_AUDIO_BYTES)
        depth = store.send_audio(owner, str(session_id), pcm)
        return {"accepted": True, "queue_depth": depth}

    @api.get("/sessions/{session_id}/metrics")
    def metrics(session_id: uuid.UUID, owner: str = Depends(authenticate)) -> dict:
        return store.get_session(owner, str(session_id)).metrics()

    @api.get("/sessions/{session_id}/preview")
    def preview(session_id: uuid.UUID, owner: str = Depends(authenticate)) -> StreamingResponse:
        store.get_session(owner, str(session_id))
        return StreamingResponse(
            store.frames(owner, str(session_id)),
            media_type="multipart/x-mixed-replace; boundary=frame",
            headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
        )

    @api.get("/sessions/{session_id}/frame")
    def latest_frame(session_id: uuid.UUID, owner: str = Depends(authenticate)) -> Response:
        if not dev_fallback_enabled():
            raise HTTPException(status_code=404, detail="Not found")
        session = store.get_session(owner, str(session_id))
        with session.lock:
            frame = session.latest_frame
            count = session.frames_generated
        headers = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Count": str(count)}
        return Response(frame, status_code=200 if frame else 204, media_type="image/jpeg", headers=headers)

    @api.post("/sessions/{session_id}/stop")
    def stop_presenter(session_id: uuid.UUID, owner: str = Depends(authenticate)) -> dict:
        return {"status": store.stop_session(owner, str(session_id))}

    return api
