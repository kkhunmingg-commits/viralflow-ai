"""Opt-in local real-media proof. No cloud credentials, paid APIs or TikTok calls.

Runs the existing TypeScript domain pipeline against the owner-scoped worker.
The receiver is live before generation; it receives bytes while inference runs.
"""
from __future__ import annotations

import argparse
import json
import os
import secrets
import subprocess
import sys
import threading
import time
from pathlib import Path

from av_pipeline import AVSessionStream
from av_encoder import EncoderConfig
from direct_stream import GenericRTMPProvider, LocalRTMPReceiver
from provider_config import dev_fallback_enabled
from worker_core import LiveStore


def main() -> None:
    if not dev_fallback_enabled() or os.getenv("AI_LIVE_DIRECT_STREAM_PROOF") != "1":
        raise RuntimeError("DIRECT_STREAM_PROOF_DISABLED")
    parser = argparse.ArgumentParser()
    parser.add_argument("--context", type=Path, required=True)
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--seconds", type=int, default=600)
    parser.add_argument("--worker-port", type=int, default=18765)
    parser.add_argument("--rtmp-port", type=int, default=19350)
    parser.add_argument("--reconnect-at", type=int, default=90)
    args = parser.parse_args()
    if not 12 <= args.seconds <= 3600:
        raise ValueError("INVALID_PROOF_DURATION")
    root = Path(__file__).resolve().parents[2]
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    context = json.loads(args.context.read_text(encoding="utf-8"))
    token = secrets.token_urlsafe(48)
    key = secrets.token_hex(16)  # Local-only key, never emitted to logs.
    receiver = LocalRTMPReceiver(output / "received.flv", port=args.rtmp_port, stream_key=key)
    receiver.start()
    time.sleep(.4)
    providers: list[GenericRTMPProvider] = []

    def stream_factory(_owner: str, session_id: str, path: Path) -> AVSessionStream:
        provider = GenericRTMPProvider(receiver.server_url, receiver.stream_key, session_id=session_id)
        providers.append(provider)
        return AVSessionStream(output / (session_id + ".mp4"), provider, EncoderConfig())

    store = LiveStore(output / "references", stream_factory=stream_factory,
                      direct_audio=True, audio_idle_timeout_seconds=60)
    reference = store.save_reference(context["ownerId"], args.reference.read_bytes(), "image/png")
    from app import create_app
    import uvicorn
    server = uvicorn.Server(uvicorn.Config(create_app(token, store=store), host="127.0.0.1",
                                          port=args.worker_port, log_level="error", access_log=False))
    server_thread = threading.Thread(target=server.run, name="local-proof-worker", daemon=True)
    server_thread.start()
    deadline = time.monotonic() + 15
    while not server.started and time.monotonic() < deadline:
        time.sleep(.1)
    if not server.started:
        store.close()
        receiver.stop()
        raise RuntimeError("PROOF_WORKER_START_FAILED")
    child_env = os.environ.copy()
    child_env.update({"AI_LIVE_WORKER_TOKEN": token, "AI_LIVE_PROOF_REFERENCE_ID": reference,
                      "AI_LIVE_PROOF_WORKER_ORIGIN": f"http://127.0.0.1:{args.worker_port}",
                      "AI_LIVE_PROOF_PYTHON": sys.executable,
                      "AI_LIVE_DIRECT_STREAM_DURATION_SECONDS": str(args.seconds)})
    tsx = root / "node_modules/tsx/dist/cli.mjs"
    command = ["node", str(tsx), str(root / "scripts/ai-live-direct-stream-proof.ts"),
               str(args.context.resolve()), str(output / "pipeline.json")]
    receiver_samples = []
    started_stream_at = None
    reconnect_done = False
    recovered_receiver = None
    try:
        with (output / "domain.log").open("wb") as log:
            process = subprocess.Popen(command, cwd=root, env=child_env, stdout=log, stderr=log,
                                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            started = time.monotonic()
            while process.poll() is None:
                now = time.monotonic()
                metrics = providers[-1].metrics() if providers else {}
                if metrics.get("status") == "LIVE" and started_stream_at is None:
                    started_stream_at = now
                elapsed = now - started_stream_at if started_stream_at else 0
                if args.reconnect_at > 0 and elapsed >= args.reconnect_at and not reconnect_done:
                    receiver.stop()
                    time.sleep(.5)
                    recovered_receiver = LocalRTMPReceiver(output / "received-reconnected.flv",
                        port=args.rtmp_port, stream_key=key)
                    recovered_receiver.start()
                    reconnect_done = True
                current_receiver = recovered_receiver or receiver
                receiver_samples.append({"elapsed_seconds": round(elapsed, 3),
                    **current_receiver.metrics(), "transport": metrics})
                receiver_samples = receiver_samples[-750:]
                if now - started > args.seconds + 300:
                    process.kill()
                    raise RuntimeError("REAL_PROOF_TIMEOUT")
                time.sleep(1)
            if process.returncode:
                raise RuntimeError("REAL_DOMAIN_STREAM_PROOF_FAILED")
            print(json.dumps({"event": "DIRECT_STREAM_PROOF_COMPLETE", "seconds": args.seconds,
                              "report": str(output / "pipeline.json")}), flush=True)
    finally:
        if 'process' in locals() and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        server.should_exit = True
        server_thread.join(timeout=30)
        store.close()
        receiver.stop()
        if recovered_receiver:
            recovered_receiver.stop()
        (output / "receiver.json").write_text(json.dumps({"samples": receiver_samples,
            "reconnect_injected": reconnect_done, "receiver_closed": True,
            "worker_closed": not server_thread.is_alive()}, indent=2), encoding="utf-8")
        token = key = ""
        child_env.pop("AI_LIVE_WORKER_TOKEN", None)
    if server_thread.is_alive() or any(not session.metrics().get("resources_released") for session in store.sessions.values()):
        raise RuntimeError("PROOF_RESOURCES_NOT_RELEASED")


if __name__ == "__main__":
    # The isolated proof owns this entire process. Media and worker cleanup is
    # verified first; then release the imported native CPU runtime as a unit.
    # On this Windows/PyTorch build ordinary interpreter finalization remains
    # resident even after all Python threads, sockets and children are closed.
    # This is not the customer agent and cannot terminate another process.
    result = 0
    try:
        main()
    except Exception as exc:
        print(type(exc).__name__ + ": " + str(exc), file=sys.stderr, flush=True)
        result = 1
    sys.stdout.flush()
    sys.stderr.flush()
    if os.name == "nt":
        # ExitProcess (also used by os._exit on Windows) invokes native DLL
        # detach handlers. This isolated CPU proof was observed remaining in
        # that phase after all media, threads, sockets and children were closed.
        # Terminate only our own process after the explicit cleanup/checks above;
        # the customer agent never uses this development-helper shutdown path.
        import ctypes
        native = ctypes.WinDLL("kernel32", use_last_error=True)
        native.GetCurrentProcess.restype = ctypes.c_void_p
        native.TerminateProcess.argtypes = (ctypes.c_void_p, ctypes.c_uint)
        native.TerminateProcess.restype = ctypes.c_int
        native.TerminateProcess(native.GetCurrentProcess(), result)
    os._exit(result)
