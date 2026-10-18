"""LIVE Lite speech backends behind LIVE Pro's ManagedLocalTTSProvider contract.

Cloud voices (Azure AI Speech, Google Cloud Text-to-Speech) are used only when
the owner configures their own key; there is no default key, no silent paid
fallback and no unofficial endpoint. Every request is metered in characters
so the session report can state usage and the owner-configured price.

espeak-ng and Windows SAPI are technical-test voices: they prove timing and
transport, not natural Thai speech.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import shutil
import subprocess
import threading
import time
import urllib.error
import urllib.request
import wave
from dataclasses import dataclass, field
from typing import Callable, Iterator
from xml.sax.saxutils import escape

import numpy as np

from local_tts import ManagedLocalTTSProvider

PCM_RATE = 16_000
CHUNK_BYTES = 6_400  # 200 ms; small enough for prompt lip-sync and interruption


class CloudTTSError(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass
class UsageMeter:
    """Character usage and owner-configured price; never a hard-coded price claim."""
    provider: str
    price_usd_per_million: float | None = None
    free_characters: int = 0
    characters: int = 0
    requests: int = 0
    first_audio_ms: list[float] = field(default_factory=list)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def record(self, characters: int, first_audio_ms: float | None) -> None:
        with self._lock:
            self.characters += characters
            self.requests += 1
            if first_audio_ms is not None:
                self.first_audio_ms.append(first_audio_ms)

    def report(self) -> dict[str, object]:
        with self._lock:
            samples = sorted(self.first_audio_ms)
            billable = max(0, self.characters - self.free_characters)
            cost = (None if self.price_usd_per_million is None
                    else round(billable * self.price_usd_per_million / 1_000_000, 6))
            pick = lambda q: round(samples[int((len(samples) - 1) * q)], 1) if samples else None
            return {"provider": self.provider, "characters": self.characters, "requests": self.requests,
                    "billable_characters_after_configured_free_tier": billable,
                    "configured_price_usd_per_million": self.price_usd_per_million,
                    "estimated_cost_usd": cost, "cost_basis": "OWNER_CONFIGURED_PRICE" if cost is not None else "PRICE_NOT_CONFIGURED",
                    "first_audio_p50_ms": pick(0.5), "first_audio_p95_ms": pick(0.95)}


def meter_from_env(provider: str) -> UsageMeter:
    def number(name, cast):
        value = os.getenv(name, "").strip()
        try:
            return cast(value) if value else None
        except ValueError:
            return None
    return UsageMeter(provider, number("AI_LIVE_TTS_PRICE_USD_PER_MILLION", float),
                      number("AI_LIVE_TTS_FREE_CHARACTERS", int) or 0)


def _resample_to_16k(samples: np.ndarray, rate: int) -> bytes:
    if rate == PCM_RATE:
        data = samples
    else:
        duration = len(samples) / rate
        target = np.arange(0, int(duration * PCM_RATE)) / PCM_RATE
        data = np.interp(target, np.arange(len(samples)) / rate, samples.astype(np.float32))
    return np.clip(data, -32768, 32767).astype("<i2").tobytes()


def _wav_to_pcm16(data: bytes) -> bytes:
    with wave.open(io.BytesIO(data), "rb") as handle:
        if handle.getsampwidth() != 2:
            raise CloudTTSError("TTS_AUDIO_FORMAT_INVALID")
        frames = np.frombuffer(handle.readframes(handle.getnframes()), dtype="<i2")
        if handle.getnchannels() > 1:
            frames = frames.reshape(-1, handle.getnchannels()).mean(axis=1)
        return _resample_to_16k(frames, handle.getframerate())


Transport = Callable[[urllib.request.Request, float], object]


def _default_transport(request: urllib.request.Request, timeout: float):
    return urllib.request.urlopen(request, timeout=timeout)


class _HTTPBackend:
    provider = "cloud"

    def __init__(self, *, timeout_seconds: float, transport: Transport | None, meter: UsageMeter | None):
        self._timeout = timeout_seconds
        self._transport = transport or _default_transport
        self.meter = meter or meter_from_env(self.provider)
        self._closed = False
        self._failures = 0

    def _open(self, request: urllib.request.Request):
        try:
            return self._transport(request, self._timeout)
        except urllib.error.HTTPError as error:
            self._failures += 1
            raise CloudTTSError("TTS_AUTH_FAILED" if error.code in (401, 403) else
                                "TTS_RATE_LIMITED" if error.code == 429 else "TTS_REQUEST_FAILED") from None
        except (urllib.error.URLError, TimeoutError, OSError):
            self._failures += 1
            raise CloudTTSError("TTS_NETWORK_FAILED") from None

    def close(self) -> None:
        self._closed = True


class AzureSpeechBackend(_HTTPBackend):
    """Azure AI Speech REST text-to-speech, raw 16 kHz PCM, streamed as it arrives."""
    provider = "azure-speech"

    def __init__(self, *, key: str, region: str, voice: str = "th-TH-PremwadeeNeural", rate: str = "+0%",
                 timeout_seconds: float = 8.0, transport: Transport | None = None, meter: UsageMeter | None = None):
        super().__init__(timeout_seconds=timeout_seconds, transport=transport, meter=meter)
        if not key or not region.replace("-", "").isalnum() or not voice.startswith("th-TH-"):
            raise CloudTTSError("TTS_CONFIG_INVALID")
        self._key, self._region, self._voice, self._rate = key, region, voice, rate

    @property
    def fingerprint(self) -> str:
        return hashlib.sha256(f"azure\0{self._region}\0{self._voice}\0{self._rate}".encode()).hexdigest()

    def health(self) -> dict[str, object]:
        return {"ready": not self._closed, "provider": self.provider, "voice": self._voice}

    def stream_sentence(self, text: str, stop: threading.Event) -> Iterator[bytes]:
        ssml = (f"<speak version='1.0' xml:lang='th-TH'><voice name='{self._voice}'>"
                f"<prosody rate='{escape(self._rate)}'>{escape(text)}</prosody></voice></speak>")
        request = urllib.request.Request(
            f"https://{self._region}.tts.speech.microsoft.com/cognitiveservices/v1", data=ssml.encode("utf-8"),
            method="POST", headers={"Ocp-Apim-Subscription-Key": self._key,
                                    "Content-Type": "application/ssml+xml",
                                    "X-Microsoft-OutputFormat": "raw-16khz-16bit-mono-pcm",
                                    "User-Agent": "ViralFlowLiveLite"})
        started = time.monotonic()
        first = None
        response = self._open(request)
        pending = b""
        try:
            while not stop.is_set():
                block = response.read(CHUNK_BYTES)
                if not block:
                    break
                pending += block
                usable = len(pending) - len(pending) % 2
                if usable:
                    if first is None:
                        first = (time.monotonic() - started) * 1000
                    yield pending[:usable]
                    pending = pending[usable:]
        finally:
            response.close()
            self.meter.record(len(text), first)


class GoogleCloudTTSBackend(_HTTPBackend):
    """Google Cloud Text-to-Speech REST (LINEAR16 16 kHz)."""
    provider = "google-cloud-tts"

    def __init__(self, *, api_key: str, voice: str, timeout_seconds: float = 8.0,
                 transport: Transport | None = None, meter: UsageMeter | None = None):
        super().__init__(timeout_seconds=timeout_seconds, transport=transport, meter=meter)
        if not api_key or not voice.startswith("th-TH-"):
            raise CloudTTSError("TTS_CONFIG_INVALID")
        self._key, self._voice = api_key, voice

    @property
    def fingerprint(self) -> str:
        return hashlib.sha256(f"google\0{self._voice}".encode()).hexdigest()

    def health(self) -> dict[str, object]:
        return {"ready": not self._closed, "provider": self.provider, "voice": self._voice}

    def stream_sentence(self, text: str, stop: threading.Event) -> Iterator[bytes]:
        body = json.dumps({"input": {"text": text}, "voice": {"languageCode": "th-TH", "name": self._voice},
                           "audioConfig": {"audioEncoding": "LINEAR16", "sampleRateHertz": PCM_RATE}}).encode()
        request = urllib.request.Request("https://texttospeech.googleapis.com/v1/text:synthesize", data=body,
                                         method="POST", headers={"Content-Type": "application/json",
                                                                 "X-Goog-Api-Key": self._key})
        started = time.monotonic()
        response = self._open(request)
        try:
            payload = json.loads(response.read(8 * 1024 * 1024))
        except (ValueError, OSError):
            raise CloudTTSError("TTS_RESPONSE_INVALID") from None
        finally:
            response.close()
        audio = base64.b64decode(payload.get("audioContent", ""), validate=True) if isinstance(payload, dict) else b""
        pcm = _wav_to_pcm16(audio) if audio.startswith(b"RIFF") else audio
        self.meter.record(len(text), (time.monotonic() - started) * 1000)
        for offset in range(0, len(pcm), CHUNK_BYTES):
            if stop.is_set():
                return
            yield pcm[offset:offset + CHUNK_BYTES]


class EspeakTechnicalBackend:
    """espeak-ng Thai: fast, robotic. Technical timing tests only."""
    provider = "espeak-ng-technical-test"
    technical_test_only = True

    def __init__(self, executable: str | None = None, *, speed: int = 150):
        self._exe = executable or shutil.which("espeak-ng")
        self._speed = speed
        self.meter = UsageMeter(self.provider, 0.0)

    @property
    def fingerprint(self) -> str:
        return hashlib.sha256(f"espeak\0{self._speed}".encode()).hexdigest()

    def health(self) -> dict[str, object]:
        return {"ready": bool(self._exe), "provider": self.provider, "technical_test_only": True}

    def stream_sentence(self, text: str, stop: threading.Event) -> Iterator[bytes]:
        if not self._exe:
            raise CloudTTSError("TTS_ENGINE_UNAVAILABLE")
        started = time.monotonic()
        result = subprocess.run([self._exe, "-v", "th", "-s", str(self._speed), "--stdout", text],
                                capture_output=True, timeout=20, check=False)
        if result.returncode or not result.stdout.startswith(b"RIFF"):
            raise CloudTTSError("TTS_ENGINE_FAILED")
        pcm = _wav_to_pcm16(result.stdout)
        self.meter.record(len(text), (time.monotonic() - started) * 1000)
        for offset in range(0, len(pcm), CHUNK_BYTES):
            if stop.is_set():
                return
            yield pcm[offset:offset + CHUNK_BYTES]

    def close(self) -> None:
        pass


class SpeechProvider(ManagedLocalTTSProvider):
    """LIVE Pro's sentence/cache/interrupt provider, reporting the real backend."""

    def health(self) -> dict[str, object]:
        result = super().health()
        backend = self.backend
        cloud = isinstance(backend, _HTTPBackend)
        result.update({"local": not cloud, "requires_api_key": cloud, "provider": getattr(backend, "provider", None),
                       "technical_test_only": bool(getattr(backend, "technical_test_only", False)),
                       "status": result["status"].replace("LOCAL_TTS", "LITE_TTS")})
        return result

    def usage(self) -> dict[str, object]:
        meter = getattr(self.backend, "meter", None)
        return meter.report() if meter else {}


def backend_from_env() -> object:
    """Owner-configured voice. No key means no cloud voice (fail closed)."""
    choice = os.getenv("AI_LIVE_LITE_TTS", "").strip()
    if choice == "azure":
        return AzureSpeechBackend(key=os.getenv("AZURE_SPEECH_KEY", "").strip(),
                                  region=os.getenv("AZURE_SPEECH_REGION", "").strip(),
                                  voice=os.getenv("AZURE_SPEECH_VOICE", "th-TH-PremwadeeNeural").strip())
    if choice == "google":
        return GoogleCloudTTSBackend(api_key=os.getenv("GOOGLE_TTS_API_KEY", "").strip(),
                                     voice=os.getenv("GOOGLE_TTS_VOICE", "").strip())
    if choice == "espeak":
        return EspeakTechnicalBackend()
    raise CloudTTSError("LITE_TTS_NOT_CONFIGURED")
