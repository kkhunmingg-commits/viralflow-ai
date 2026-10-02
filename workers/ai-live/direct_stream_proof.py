"""Opt-in local real-media proof. No cloud credentials, paid APIs or TikTok calls.

Runs the existing TypeScript domain pipeline against the owner-scoped worker.
The receiver is live before generation; it receives bytes while inference runs.
"""
from __future__ import annotations

import argparse
from contextlib import ExitStack
import json
import os
import secrets
import subprocess
import sys
import threading
import time
from pathlib import Path

from av_pipeline import AVSessionStream
from direct_stream import GenericRTMPProvider
from provider_config import dev_fallback_enabled
from receiver_player import PlayingRTMPReceiver, ReceiverPlayer


class LocalBoundaryProofStore:
    """DEV HTTP test facade over the SAME media worker used by Local Agent.

    Authentication stays at the existing loopback API; the facade delegates
    Start/audio/Stop to LocalWorkerBoundary, not a second media implementation.
    """
    def __init__(self, worker, context):
        self.worker = worker
        self.context = context

    def __getattr__(self, name):
        return getattr(self.worker.store, name)

    def _call(self, method, *args):
        from local_agent.agent import AgentError
        from worker_core import LiveError
        try:
            return method(*args)
        except AgentError as exc:
            raise LiveError(exc.status, exc.code, exc.message) from None

    def start_session(self, owner, reference, _fps, unused_engine):
        unused_engine.close()  # HTTP creates an unprepared engine; worker owns its actual engine.
        if owner != self.context["ownerId"]:
            from worker_core import LiveError
            raise LiveError(404, "SESSION_NOT_FOUND", "Not found")
        path = self.worker.store.get_reference(owner, reference).path
        session = self._call(self.worker.start_session, owner, self.context["accountId"],
            tuple(product["id"] for product in self.context["products"]), path, None)
        return session, self.worker.store.get_session(owner, session)

    def send_audio(self, owner, session, pcm):
        return self._call(self.worker.push_audio, owner, session, pcm)

    def stop_session(self, owner, session):
        self._call(self.worker.stop_session, owner, session)
        return self.worker.store.get_session(owner, session).status

    def close(self):
        self.worker.close()


def stop_child(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def stop_server(server, thread):
    server.should_exit = True
    if thread.ident is not None:
        thread.join(timeout=30)
    if thread.is_alive():
        raise RuntimeError("PROOF_WORKER_STOP_FAILED")


class ProofCleanup(ExitStack):
    """Try every owned cleanup even if an earlier release fails.

    Retain the original startup/runtime failure; report cleanup failure on an
    otherwise successful run. Diagnostics cannot contain keys or native errors.
    """
    def __init__(self):
        super().__init__()
        self.failed = False

    def release(self, callback, *args):
        def attempt():
            try:
                callback(*args)
            except Exception:
                self.failed = True
        self.callback(attempt)


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
    parser.add_argument("--player-port", type=int, default=18866)
    args = parser.parse_args()
    if not 12 <= args.seconds <= 3600:
        raise ValueError("INVALID_PROOF_DURATION")
    root = Path(__file__).resolve().parents[2]
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    context = json.loads(args.context.read_text(encoding="utf-8"))
    token = secrets.token_urlsafe(48)
    key = secrets.token_hex(16)  # Local-only key, never emitted to logs.
    cleanup = ProofCleanup()
    with cleanup:
        player = ReceiverPlayer(args.player_port)
        cleanup.release(player.stop)
        player.start()
        receiver = PlayingRTMPReceiver(output / "received.flv", port=args.rtmp_port, stream_key=key, player=player)
        cleanup.release(receiver.stop)
        receiver.start()
        time.sleep(.4)
        providers: list[GenericRTMPProvider] = []

        def provider_factory(server_url: str, stream_key: str):
            provider = GenericRTMPProvider(server_url, stream_key)
            providers.append(provider)
            return provider

        from local_agent.live_worker import LocalWorkerBoundary
        from local_agent.stream_credentials import StreamCredentialStore
        credentials = StreamCredentialStore(output / "local-test-credentials")
        cleanup.release(credentials.delete, context["ownerId"], context["accountId"])
        credentials.put(context["ownerId"], context["accountId"], receiver.server_url, key)
        def stream_factory(path, *, provider, config):
            return AVSessionStream(output / path.name, provider, config)
        worker = LocalWorkerBoundary(output / "local-worker", credentials,
            provider_factory=provider_factory, stream_factory=stream_factory)
        cleanup.release(worker.close)
        store = LocalBoundaryProofStore(worker, context)
        reference = store.save_reference(context["ownerId"], args.reference.read_bytes(), "image/png")
        from app import create_app
        import uvicorn
        server = uvicorn.Server(uvicorn.Config(create_app(token, store=store), host="127.0.0.1",
                                              port=args.worker_port, log_level="error", access_log=False))
        server_thread = threading.Thread(target=server.run, name="local-proof-worker", daemon=True)
        cleanup.release(stop_server, server, server_thread)
        server_thread.start()
        deadline = time.monotonic() + 15
        while not server.started and time.monotonic() < deadline:
            time.sleep(.1)
        if not server.started:
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
        with (output / "domain.log").open("wb") as log:
            process = subprocess.Popen(command, cwd=root, env=child_env, stdout=log, stderr=log,
                                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            cleanup.release(stop_child, process)
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
                    recovered_receiver = PlayingRTMPReceiver(output / "received-reconnected.flv",
                        port=args.rtmp_port, stream_key=key, player=player)
                    cleanup.release(recovered_receiver.stop)
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
            report_path = output / "pipeline.json"
            report = json.loads(report_path.read_text(encoding="utf-8"))
            report["proofBoundary"] = "LocalWorkerBoundary"
            report["producerSessionCount"] = len(worker._sessions)
            report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    if cleanup.failed or any(not session.metrics().get("resources_released") for session in store.sessions.values()):
        raise RuntimeError("PROOF_RESOURCES_NOT_RELEASED")
    (output / "receiver.json").write_text(json.dumps({"samples": receiver_samples,
        "reconnect_injected": reconnect_done, "receiver_closed": True,
        "worker_closed": not server_thread.is_alive(), "live_player": player.evidence()}, indent=2), encoding="utf-8")
    token = key = ""
    child_env.pop("AI_LIVE_WORKER_TOKEN", None)
    print(json.dumps({"event": "DIRECT_STREAM_PROOF_COMPLETE", "seconds": args.seconds,
                      "report": str(output / "pipeline.json")}), flush=True)


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
