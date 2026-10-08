"""Explicit DEV-only offline Windows speech; never a silent paid TTS fallback.

Text is sent as a temporary UTF-8 JSON file to a fixed PowerShell file, never interpolated
as executable shell text. Synthesized speech is converted by SAPI directly to
mono 16-kHz PCM16 and forwarded through the existing VoiceProvider contract.
The temporary WAV is audio only: presenter frames still require real inference.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import uuid
import wave
from pathlib import Path
from typing import Callable, Iterator

from voice import SpeechChunk
from provider_config import dev_fallback_enabled
from compliance_speech import ComplianceSpeechError


def dev_enabled(environment: dict[str, str] | None = None) -> bool:
    env = os.environ if environment is None else environment
    return dev_fallback_enabled(env)


class WindowsOfflineVoice:
    def __init__(self, data_dir: Path, *, compliance_authorize: Callable[[str], str] | None = None) -> None:
        if not dev_enabled():
            raise RuntimeError('DEV_FALLBACK_DISABLED')
        if os.name != 'nt':
            raise RuntimeError('WINDOWS_OFFLINE_VOICE_REQUIRED')
        self._data_dir = data_dir.resolve()
        self._data_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._process: subprocess.Popen | None = None
        self._cancelled = False
        self._interrupted = threading.Event()
        self._compliance_authorize = compliance_authorize

    def health(self) -> dict[str, object]:
        return {'ready': not self._cancelled and dev_enabled(), 'status': 'DEV_OFFLINE_VOICE'}

    def stream_text(self, text: str, utterance_id: str) -> Iterator[SpeechChunk]:
        if not dev_enabled() or self._cancelled:
            raise RuntimeError('DEV_FALLBACK_DISABLED')
        if not text.strip() or len(text) > 1000 or not utterance_id:
            raise ValueError('INVALID_SPEECH_REQUEST')
        if self._compliance_authorize is None:
            raise ComplianceSpeechError()
        text = self._compliance_authorize(text)
        if not isinstance(text, str) or not text.strip() or len(text) > 1000:
            raise ComplianceSpeechError('LIVE_COMPLIANCE_BINDING_INVALID')
        self._interrupted.clear()
        path = self._data_dir / f'{uuid.uuid4()}.wav'
        request_path = path.with_suffix('.json')
        script = Path(__file__).with_suffix('.ps1')
        payload = json.dumps({'text': text, 'output': str(path)}, ensure_ascii=False).encode('utf-8')
        request_path.write_bytes(payload)
        try:
            with self._lock:
                if self._process is not None:
                    raise RuntimeError('VOICE_BUSY')
                process = subprocess.Popen(
                    [shutil.which('pwsh.exe') or 'powershell.exe', '-NoProfile', '-NonInteractive', '-File', str(script), '-RequestPath', str(request_path)],
                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                    creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                self._process = process
            try:
                _, _ = process.communicate(timeout=90)
            except subprocess.TimeoutExpired:
                process.kill()
                process.communicate()
                raise RuntimeError('OFFLINE_VOICE_TIMEOUT') from None
            if self._interrupted.is_set():
                return
            if process.returncode != 0 or not path.is_file():
                raise RuntimeError('OFFLINE_VOICE_UNAVAILABLE')
            with wave.open(str(path), 'rb') as audio:
                if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (1, 2, 16000):
                    raise RuntimeError('INVALID_OFFLINE_VOICE_FORMAT')
                if audio.getnframes() > 16000 * 120:
                    raise RuntimeError('OFFLINE_VOICE_TOO_LONG')
                while not self._interrupted.is_set():
                    pcm = audio.readframes(16000)
                    if not pcm:
                        break
                    if self._compliance_authorize(text) != text:
                        raise ComplianceSpeechError('LIVE_COMPLIANCE_BINDING_INVALID')
                    if self._interrupted.is_set():
                        return
                    yield SpeechChunk(pcm, utterance_id)
        finally:
            if 'process' in locals() and process.poll() is None:
                process.kill()
                process.communicate()
            with self._lock:
                if self._process is locals().get('process'):
                    self._process = None
            path.unlink(missing_ok=True)
            request_path.unlink(missing_ok=True)

    def interrupt(self) -> None:
        self._interrupted.set()
        with self._lock:
            if self._process is not None and self._process.poll() is None:
                self._process.kill()

    def cancel(self) -> None:
        self._cancelled = True
        self.interrupt()


def main() -> None:
    sys.stdin.reconfigure(encoding='utf-8', errors='strict')
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    request = json.loads(sys.stdin.read(8192))
    text = request.get('text')
    if not isinstance(text, str):
        raise ValueError('INVALID_SPEECH_REQUEST')
    voice = WindowsOfflineVoice(Path(tempfile.gettempdir()) / 'viralflow-proof-voice')
    try:
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            with wave.open(str(args.output), 'wb') as output:
                output.setnchannels(1)
                output.setsampwidth(2)
                output.setframerate(16000)
                for chunk in voice.stream_text(text, 'dev-utterance'):
                    output.writeframes(chunk.pcm16)
        else:
            for chunk in voice.stream_text(text, 'dev-utterance'):
                sys.stdout.buffer.write(chunk.pcm16)
                sys.stdout.buffer.flush()
    finally:
        voice.cancel()


if __name__ == '__main__':
    main()
