"""Wall-clock real CPU proof: authenticated worker HTTP -> JPEG -> software sink.

This local-only tool does not call TikTok, change membership, or enable LIVE.
It records measurements rather than substituting synthetic presenter frames.
The optional read-only browser proof server keeps worker credentials server-side.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import secrets
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import wave
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from provider_config import dev_fallback_enabled


PAGE = b'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ViralFlow DEV proof</title><style>body{background:#10131d;color:#edf0ff;font:16px system-ui;margin:0;padding:30px}main{max-width:900px;margin:auto}h1{font-size:28px}.layout{display:grid;grid-template-columns:minmax(256px,1fr) 1fr;gap:25px}img{width:100%;max-width:420px;border-radius:24px;min-height:256px;background:#1b2030}pre{white-space:pre-wrap;overflow-wrap:anywhere;color:#91dfcf}strong{color:#bcaaff}audio{max-width:100%;margin:20px 0}@media(max-width:600px){.layout{grid-template-columns:1fr}body{padding:20px}}</style><main><h1>ViralFlow AI LIVE <strong>DEV proof</strong></h1><p>Actual CPU inference frames. No TikTok stream. Production LIVE remains disabled.</p><div class="layout"><div><img id="preview" alt="Waiting for the first actual inferred frame"><audio controls src="/speech.wav"></audio><p>Audio is the real offline speech fixture. The slow CPU preview is not synchronized real-time playback.</p></div><pre id="status">Waiting for session</pre></div></main><script>let count=0;async function poll(){try{const r=await fetch('/metrics',{cache:'no-store'});const m=await r.json();document.querySelector('#status').textContent=JSON.stringify(m,null,2);if(m.frames_generated>count){count=m.frames_generated;document.querySelector('#preview').src='/frame?frame='+count;}}catch{document.querySelector('#status').textContent='Proof server unavailable';}setTimeout(poll,1000)}poll()</script></html>'''


class PhysicalMicrophone:
    """Actual local microphone callbacks, with a two-second bounded history."""

    def __init__(self, device_index: int | None = None) -> None:
        import sounddevice
        devices = sounddevice.query_devices()
        def eligible(device) -> bool:
            name = device['name'].lower()
            return (device['max_input_channels'] > 0 and 'microphone' in name
                    and not any(word in name for word in ('virtual', 'cable', 'stereo mix', 'loopback')))
        if device_index is None:
            default = int(sounddevice.default.device[0])
            device_index = default if 0 <= default < len(devices) and eligible(devices[default]) else next(
                (index for index, device in enumerate(devices) if eligible(device)), None)
        if device_index is None or not 0 <= device_index < len(devices) or not eligible(devices[device_index]):
            raise RuntimeError('PHYSICAL_MICROPHONE_REQUIRED')
        self._lock = threading.Lock()
        self._chunks: deque[bytes] = deque(maxlen=2)
        self._stats = {'device_index': device_index, 'device_name': devices[device_index]['name'],
                       'hostapi': sounddevice.query_hostapis(devices[device_index]['hostapi'])['name'],
                       'sample_rate': 16000, 'channels': 1, 'format': 'PCM16', 'captured_chunks': 0,
                       'captured_bytes': 0, 'nonzero_sample_bytes': 0, 'input_overflows': 0,
                       'dropped_chunks': 0, 'submitted_chunks': 0, 'max_queue_depth': 0}
        def callback(audio, frames, timing, status) -> None:
            pcm = bytes(audio)
            if not pcm or len(pcm) > 32000 or len(pcm) % 2:
                return
            with self._lock:
                self._stats['captured_chunks'] += 1
                self._stats['captured_bytes'] += len(pcm)
                self._stats['nonzero_sample_bytes'] += sum(value != 0 for value in pcm)
                self._stats['input_overflows'] += int(status.input_overflow)
                if len(self._chunks) == self._chunks.maxlen:
                    self._stats['dropped_chunks'] += 1
                self._chunks.append(pcm)
                self._stats['max_queue_depth'] = max(self._stats['max_queue_depth'], len(self._chunks))
        self._stream = sounddevice.RawInputStream(device=device_index, samplerate=16000,
                                                 channels=1, dtype='int16', blocksize=16000,
                                                 callback=callback)
        try:
            self._stream.start()
        except Exception:
            self._stream.close()
            raise

    def pop(self) -> bytes | None:
        with self._lock:
            if not self._chunks:
                return None
            self._stats['submitted_chunks'] += 1
            return self._chunks.popleft()

    def close(self) -> dict:
        close_error = None
        try:
            self._stream.stop()
        except Exception as exc:
            close_error = type(exc).__name__
        finally:
            try:
                self._stream.close()
            except Exception as exc:
                close_error = type(exc).__name__
        with self._lock:
            self._stats['discarded_on_stop'] = len(self._chunks)
            self._chunks.clear()
            return {**self._stats, 'queue_depth': 0, 'resources_released': bool(self._stream.closed),
                    'close_error': close_error}


class ProofRun:
    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.origin = f'http://127.0.0.1:{args.worker_port}'
        self.token = secrets.token_urlsafe(48)
        self.session: str | None = None
        self.output = args.output.resolve()
        self.output.mkdir(parents=True, exist_ok=True)
        self.stopped = threading.Event()
        self.frame_hashes: set[str] = set()
        self.preview_frames = 0
        self.preview_error: str | None = None
        self.frame_lock = threading.Lock()
        self.latest_frame: bytes | None = None
        self.latest_metrics: dict = {}

    def request(self, path: str, body: bytes | None = None, content_type: str = 'application/json') -> bytes:
        req = urllib.request.Request(self.origin + path, data=body, headers={
            'Authorization': 'Bearer ' + self.token, 'X-ViralFlow-Owner-Id': self.args.owner,
            'Content-Type': content_type}, method='POST' if body is not None else 'GET')
        with urllib.request.urlopen(req, timeout=20) as result:
            return result.read()

    def metrics(self) -> dict:
        assert self.session
        result = json.loads(self.request(f'/sessions/{self.session}/metrics'))
        self.latest_metrics = result
        return result

    def consume_preview(self) -> None:
        assert self.session
        req = urllib.request.Request(self.origin + f'/sessions/{self.session}/preview', headers={
            'Authorization': 'Bearer ' + self.token, 'X-ViralFlow-Owner-Id': self.args.owner})
        try:
            with urllib.request.urlopen(req, timeout=45) as response:
                while not self.stopped.is_set():
                    line = response.readline()
                    if not line:
                        break
                    if not line.startswith(b'--frame'):
                        continue
                    size = None
                    while True:
                        line = response.readline()
                        if not line:
                            raise EOFError('PREVIEW_HEADERS_INCOMPLETE')
                        if line == b'\r\n':
                            break
                        if line.lower().startswith(b'content-length:'):
                            size = int(line.split(b':')[1])
                    if not size or size > 4 * 1024 * 1024:
                        raise ValueError('INVALID_PREVIEW_LENGTH')
                    frame = response.read(size)
                    if not frame.startswith(b'\xff\xd8') or not frame.endswith(b'\xff\xd9'):
                        raise ValueError('INVALID_PREVIEW_JPEG')
                    digest = hashlib.sha256(frame).hexdigest()
                    with self.frame_lock:
                        self.frame_hashes.add(digest)
                        self.preview_frames += 1
                        self.latest_frame = frame
                        if self.preview_frames == 1:
                            (self.output / 'first-frame.jpg').write_bytes(frame)
        except Exception as exc:
            if not self.stopped.is_set():
                self.preview_error = type(exc).__name__

    def browser_server(self) -> ThreadingHTTPServer:
        run = self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args: object) -> None:
                pass
            def do_GET(self) -> None:
                if self.headers.get('Host') not in {f'127.0.0.1:{run.args.preview_port}', f'localhost:{run.args.preview_port}'}:
                    self.send_error(403)
                    return
                path = self.path.split('?')[0]
                if path == '/':
                    payload, kind = PAGE, 'text/html; charset=utf-8'
                    if run.args.microphone:
                        payload = payload.replace(b'Audio is the real offline speech fixture.',
                                                  b'Inference uses physical microphone input. The audio control plays the separate offline speech fixture.')
                elif path == '/metrics':
                    safe = {key: run.latest_metrics.get(key) for key in ('status', 'frames_generated', 'average_fps', 'p50_latency_ms', 'p95_latency_ms', 'cpu_percent', 'ram_mb', 'queue_depth', 'audio_chunks', 'inference_active', 'preview_status', 'frame_drops')}
                    safe['preview_frames_received'] = run.preview_frames
                    payload, kind = json.dumps(safe).encode(), 'application/json'
                elif path == '/frame':
                    with run.frame_lock:
                        payload = run.latest_frame
                    if payload is None:
                        self.send_response(204); self.end_headers(); return
                    kind = 'image/jpeg'
                elif path == '/speech.wav':
                    payload, kind = run.args.audio.read_bytes(), 'audio/wav'
                else:
                    self.send_error(404); return
                self.send_response(200)
                self.send_header('Content-Type', kind)
                self.send_header('Content-Length', str(len(payload)))
                self.send_header('Cache-Control', 'no-store')
                self.send_header('X-Content-Type-Options', 'nosniff')
                self.end_headers()
                self.wfile.write(payload)
        server = ThreadingHTTPServer(('127.0.0.1', self.args.preview_port), Handler)
        threading.Thread(target=server.serve_forever, daemon=True, name='dev-proof-browser').start()
        return server

    def execute(self) -> dict:
        import imageio_ffmpeg
        import psutil
        environment = os.environ.copy()
        environment.update({'AI_LIVE_WORKER_TOKEN': self.token, 'AI_LIVE_FFMPEG_PATH': imageio_ffmpeg.get_ffmpeg_exe(),
                            'AI_LIVE_DEV_OUTPUT_DIR': str(self.output / 'encoded')})
        worker_log = (self.output / 'worker.log').open('wb')
        worker = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'app:create_app', '--factory', '--host', '127.0.0.1',
                                   '--port', str(self.args.worker_port), '--no-access-log'], cwd=Path(__file__).parent,
                                  env=environment, stdout=worker_log, stderr=worker_log,
                                  creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        server = None
        preview_thread = None
        microphone = None
        summary: dict = {'mode': 'DEV_PROOF_ONLY', 'production_validated': False}
        try:
            deadline = time.monotonic() + 90
            while True:
                if worker.poll() is not None:
                    raise RuntimeError('WORKER_EXITED')
                try:
                    health = json.loads(self.request('/health'))
                    if not health.get('ready'):
                        raise RuntimeError('REAL_PRESENTER_NOT_READY')
                    break
                except urllib.error.URLError:
                    if time.monotonic() > deadline:
                        raise RuntimeError('WORKER_START_TIMEOUT')
                    time.sleep(.5)
            reference = json.loads(self.request('/references', self.args.reference.read_bytes(), 'image/png'))['reference_id']
            self.session = json.loads(self.request('/sessions', json.dumps({'reference_id': reference, 'target_fps': 2}).encode()))['session_id']
            deadline = time.monotonic() + 180
            while self.metrics()['status'] == 'STARTING' and time.monotonic() < deadline:
                time.sleep(.5)
            if self.metrics()['status'] != 'RUNNING':
                raise RuntimeError('INFERENCE_PREPARE_FAILED')
            with wave.open(str(self.args.audio), 'rb') as audio:
                if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (1, 2, 16000):
                    raise ValueError('INVALID_PROOF_AUDIO')
                pcm = audio.readframes(audio.getnframes())
            chunks = [pcm[index:index + 32000] for index in range(0, len(pcm), 32000)]
            if not chunks:
                raise ValueError('EMPTY_PROOF_AUDIO')
            if self.args.microphone:
                microphone = PhysicalMicrophone(self.args.microphone_device)
            preview_thread = threading.Thread(target=self.consume_preview, daemon=True, name='actual-mjpeg-consumer')
            preview_thread.start()
            server = self.browser_server()
            print(json.dumps({'event': 'PROOF_STARTED', 'preview_url': f'http://127.0.0.1:{self.args.preview_port}', 'duration_seconds': self.args.seconds}), flush=True)
            started = time.monotonic()
            samples = []
            index = 0
            while time.monotonic() - started < self.args.seconds:
                metrics = self.metrics()
                if metrics['status'] != 'RUNNING' or self.preview_error:
                    raise RuntimeError('REAL_FLOW_STOPPED')
                if metrics['queue_depth'] < 1:
                    chunk = microphone.pop() if microphone is not None else chunks[index % len(chunks)]
                    if chunk is not None:
                        self.request(f'/sessions/{self.session}/audio', chunk, 'application/octet-stream')
                        index += 1
                # Windows venv python.exe may be a launcher parent. Measure the
                # inference process through its own psutil-backed API, not Popen.pid.
                samples.append({'at_seconds': round(time.monotonic() - started, 3), 'cpu_percent': metrics['cpu_percent'],
                                'ram_mb': metrics['ram_mb'],
                                'queue_depth': metrics['queue_depth'], 'frames': metrics['frames_generated']})
                if len(samples) % 30 == 0:
                    print(json.dumps({'event': 'PROOF_PROGRESS', **samples[-1]}), flush=True)
                time.sleep(1)
            summary.update({'elapsed_seconds': round(time.monotonic() - started, 3), 'audio_chunks_sent': index})
            summary['audio_source'] = 'PHYSICAL_MICROPHONE' if microphone is not None else 'LOCAL_AUDIO_FILE'
            if microphone is not None:
                summary['microphone'] = microphone.close()
                microphone = None
            self.request(f'/sessions/{self.session}/stop', b'')
            deadline = time.monotonic() + 60
            while not self.metrics().get('resources_released') and time.monotonic() < deadline:
                time.sleep(.5)
            final = self.metrics()
            summary.update({'final_metrics': final, 'preview_frames': self.preview_frames, 'distinct_frames': len(self.frame_hashes),
                            'preview_error': self.preview_error, 'samples': samples, 'process_crash': worker.poll() is not None,
                            'max_audio_queue': max(sample['queue_depth'] for sample in samples),
                            'cpu_percent_average': sum(sample['cpu_percent'] for sample in samples) / len(samples),
                            'ram_first_mb': samples[0]['ram_mb'], 'ram_last_mb': samples[-1]['ram_mb'],
                            'ram_peak_mb': max(sample['ram_mb'] for sample in samples), 'logical_cpus': psutil.cpu_count()})
            with self.frame_lock:
                if self.latest_frame:
                    (self.output / 'last-frame.jpg').write_bytes(self.latest_frame)
            if final['status'] != 'STOPPED' or not final.get('resources_released'):
                raise RuntimeError('RESOURCES_NOT_RELEASED')
            encoder = final.get('encoder', {})
            if not final['frames_generated'] or not self.preview_frames or self.preview_error:
                raise RuntimeError('REAL_PREVIEW_NOT_VERIFIED')
            if encoder.get('status') != 'STOPPED' or encoder.get('error') or not encoder.get('frames_encoded') or not encoder.get('output_bytes'):
                raise RuntimeError('REAL_ENCODER_NOT_VERIFIED')
            if self.args.comment_context:
                repo = Path(__file__).resolve().parents[2]
                comment_environment = environment.copy()
                comment_environment.update({'AI_LIVE_PROOF_WORKER_ORIGIN': self.origin,
                                            'AI_LIVE_PROOF_REFERENCE_ID': reference,
                                            'AI_LIVE_PROOF_PYTHON': sys.executable})
                result = subprocess.run(['node', str(repo / 'node_modules/tsx/dist/cli.mjs'),
                                         str(repo / 'scripts/ai-live-comment-proof.ts'),
                                         str(self.args.comment_context.resolve()), str(self.output / 'comment-proof.json')],
                                        cwd=repo, env=comment_environment, timeout=300, check=False)
                if result.returncode != 0:
                    raise RuntimeError('COMMENT_PROOF_FAILED')
                summary['comment_proof'] = json.loads((self.output / 'comment-proof.json').read_text(encoding='utf-8'))
            print(json.dumps({'event': 'PROOF_COMPLETE', 'frames': final['frames_generated'], 'average_fps': final['average_fps']}), flush=True)
            return summary
        finally:
            self.stopped.set()
            if microphone is not None:
                summary['microphone'] = microphone.close()
            if self.session and worker.poll() is None:
                try:
                    self.request(f'/sessions/{self.session}/stop', b'')
                except Exception:
                    pass
            if server:
                server.shutdown()
                server.server_close()
            if preview_thread:
                preview_thread.join(timeout=3)
            worker.terminate()
            try:
                worker.wait(timeout=15)
            except subprocess.TimeoutExpired:
                worker.kill()
                worker.wait(timeout=5)
            worker_log.close()
            (self.output / 'proof.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')


def main() -> None:
    if not dev_fallback_enabled():
        raise RuntimeError('DEV_FALLBACK_DISABLED')
    parser = argparse.ArgumentParser()
    parser.add_argument('--reference', type=Path, required=True)
    parser.add_argument('--audio', type=Path, required=True)
    parser.add_argument('--owner', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--seconds', type=int, default=600)
    parser.add_argument('--worker-port', type=int, default=18765)
    parser.add_argument('--preview-port', type=int, default=18766)
    parser.add_argument('--comment-context', type=Path)
    parser.add_argument('--microphone', action='store_true', help='Feed actual physical microphone PCM callbacks instead of replaying the WAV')
    parser.add_argument('--microphone-device', type=int, help='Optional PortAudio index of a physical microphone')
    args = parser.parse_args()
    if not 10 <= args.seconds <= 1800:
        raise ValueError('INVALID_PROOF_DURATION')
    ProofRun(args).execute()


if __name__ == '__main__':
    main()
