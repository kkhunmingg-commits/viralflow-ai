"""LIVE Lite speech backends behind LIVE Pro's ManagedLocalTTSProvider contract.

Cloud voices (Azure AI Speech, Google Cloud Text-to-Speech) are used only when
the owner configures their own key; there is no default key, no silent paid
fallback and no unofficial endpoint. Every request is metered in characters
so the session report can state usage and the owner-configured price.

espeak-ng is a technical-test voice: it proves timing and transport, not
natural Thai speech. The Windows OneCore Thai voice (Microsoft Pattara) ships
with Windows, runs offline and costs nothing; it is clearer than espeak but
less natural than Azure neural voices.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
import wave
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterator
from xml.sax.saxutils import escape

import numpy as np

from local_tts import ManagedLocalTTSProvider

PCM_RATE = 16_000
CHUNK_BYTES = 6_400  # 200 ms; small enough for prompt lip-sync and interruption


AZURE_F0_MONTHLY_CHARACTERS = 500_000  # Azure AI Speech F0 neural TTS allowance per month
AZURE_F0_REQUESTS_PER_MINUTE = 20


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


class FreeTierGuard:
    """Keeps a cloud voice inside the free allowance; never upgrades or falls back to paid.

    A persistent per-month ledger refuses requests before the configured cap
    (default 90% of Azure F0's monthly characters), and a sliding window keeps
    requests under F0's per-minute limit by waiting briefly instead of failing.
    """
    def __init__(self, ledger_dir: Path | None, *, monthly_characters: int = int(AZURE_F0_MONTHLY_CHARACTERS * 0.9),
                 requests_per_minute: int = AZURE_F0_REQUESTS_PER_MINUTE - 2, clock=time.time,
                 sleep=time.sleep):
        if not 0 < monthly_characters <= AZURE_F0_MONTHLY_CHARACTERS or not 1 <= requests_per_minute <= 60:
            raise CloudTTSError("TTS_BUDGET_INVALID")
        self.ledger_dir, self.monthly_characters, self.per_minute = ledger_dir, monthly_characters, requests_per_minute
        self._clock, self._sleep = clock, sleep
        self._lock = threading.Lock()
        self._recent: list[float] = []

    def _ledger(self) -> Path | None:
        if self.ledger_dir is None:
            return None
        return Path(self.ledger_dir) / ("usage-" + time.strftime("%Y-%m", time.gmtime(self._clock())) + ".json")

    def used(self) -> int:
        path = self._ledger()
        try:
            value = json.loads(path.read_text(encoding="utf-8"))["characters"] if path and path.is_file() else 0
            return value if type(value) is int and value >= 0 else self.monthly_characters
        except (OSError, ValueError, KeyError, TypeError):
            return self.monthly_characters  # unreadable ledger: refuse rather than risk overage

    def admit(self, characters: int, stop: threading.Event) -> None:
        with self._lock:
            used = self.used()
            if used + characters > self.monthly_characters:
                raise CloudTTSError("TTS_FREE_TIER_BUDGET_REACHED")
            while True:
                now = self._clock()
                self._recent = [at for at in self._recent if now - at < 60]
                if len(self._recent) < self.per_minute:
                    break
                wait = 60 - (now - self._recent[0]) + 0.05
                if stop.wait(min(wait, 1.0)) if wait > 0 else False:
                    raise CloudTTSError("TTS_CANCELLED")
            self._recent.append(self._clock())
            path = self._ledger()
            if path is not None:
                path.parent.mkdir(parents=True, exist_ok=True)
                temporary = path.with_suffix(".tmp")
                temporary.write_text(json.dumps({"characters": used + characters}), encoding="utf-8")
                os.replace(temporary, path)

    def report(self) -> dict[str, object]:
        return {"monthly_cap_characters": self.monthly_characters, "used_this_month": self.used(),
                "requests_per_minute_cap": self.per_minute, "paid_fallback": False}


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
                 timeout_seconds: float = 8.0, transport: Transport | None = None, meter: UsageMeter | None = None,
                 guard: FreeTierGuard | None = None):
        super().__init__(timeout_seconds=timeout_seconds, transport=transport, meter=meter)
        if not key or not region.replace("-", "").isalnum() or not voice.startswith("th-TH-"):
            raise CloudTTSError("TTS_CONFIG_INVALID")
        self._key, self._region, self._voice, self._rate = key, region, voice, rate
        self.guard = guard

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
        if self.guard is not None:
            self.guard.admit(len(text), stop)
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


# One persistent Windows PowerShell host: base64 UTF-8 text in, base64 WAV out, one line each.
_ONECORE_HOST = r"""
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
$asTask = $asTask.MakeGenericMethod([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
$synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$voice = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices |
  Where-Object { $_.Language -eq 'th-TH' -and ($env:LITE_ONECORE_VOICE -eq '' -or $_.DisplayName -like "*$env:LITE_ONECORE_VOICE*") } |
  Select-Object -First 1
if (-not $voice) { [Console]::Out.WriteLine('ERR NO_THAI_VOICE'); exit 3 }
$synth.Voice = $voice
[Console]::Out.WriteLine('READY ' + $voice.DisplayName)
while ($null -ne ($line = [Console]::In.ReadLine())) {
  try {
    $text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line))
    $task = $asTask.Invoke($null, @($synth.SynthesizeTextToStreamAsync($text)))
    $null = $task.Wait(20000)
    $source = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($task.Result)
    $buffer = New-Object System.IO.MemoryStream
    $source.CopyTo($buffer)
    [Console]::Out.WriteLine('OK ' + [Convert]::ToBase64String($buffer.ToArray()))
  } catch { [Console]::Out.WriteLine('ERR SYNTHESIS_FAILED') }
}
"""


class WindowsOneCoreBackend:
    """Built-in Windows Thai voice (Microsoft Pattara). Offline, free, no key, no install."""
    provider = "windows-onecore-th"
    technical_test_only = False

    def __init__(self, voice: str = "", *, popen: Callable[..., subprocess.Popen] = subprocess.Popen):
        self._voice = voice
        self._popen = popen
        self._process: subprocess.Popen | None = None
        self._voice_name: str | None = None
        self._lock = threading.Lock()
        self.meter = UsageMeter(self.provider, 0.0)

    @property
    def fingerprint(self) -> str:
        return hashlib.sha256(f"onecore\0{self._voice}".encode()).hexdigest()

    def _host(self) -> subprocess.Popen:
        if self._process is not None and self._process.poll() is None:
            return self._process
        if os.name != "nt" and self._popen is subprocess.Popen:
            raise CloudTTSError("TTS_ENGINE_UNAVAILABLE")
        script = Path(tempfile.gettempdir()) / "viralflow-lite-onecore-host.ps1"
        script.write_text(_ONECORE_HOST, encoding="utf-8-sig")
        process = self._popen(["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                               "-File", str(script)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                              stderr=subprocess.DEVNULL, text=True, encoding="ascii",
                              env={**os.environ, "LITE_ONECORE_VOICE": self._voice},
                              creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        ready = process.stdout.readline().strip()
        if not ready.startswith("READY"):
            process.kill()
            raise CloudTTSError("TTS_ENGINE_UNAVAILABLE")
        self._voice_name = ready[6:] or None
        self._process = process
        return process

    def health(self) -> dict[str, object]:
        return {"ready": os.name == "nt" or self._popen is not subprocess.Popen,
                "provider": self.provider, "voice": self._voice_name, "technical_test_only": False}

    def stream_sentence(self, text: str, stop: threading.Event) -> Iterator[bytes]:
        started = time.monotonic()
        with self._lock:
            process = self._host()
            try:
                process.stdin.write(base64.b64encode(text.encode("utf-8")).decode("ascii") + "\n")
                process.stdin.flush()
                reply = process.stdout.readline().strip()
            except (OSError, ValueError):
                self.close()
                raise CloudTTSError("TTS_ENGINE_FAILED")
        if not reply.startswith("OK "):
            raise CloudTTSError("TTS_ENGINE_FAILED")
        pcm = _wav_to_pcm16(base64.b64decode(reply[3:]))
        self.meter.record(len(text), (time.monotonic() - started) * 1000)
        for offset in range(0, len(pcm), CHUNK_BYTES):
            if stop.is_set():
                return
            yield pcm[offset:offset + CHUNK_BYTES]

    def close(self) -> None:
        process, self._process = self._process, None
        if process is not None and process.poll() is None:
            try:
                process.stdin.close()
                process.wait(timeout=3)
            except (OSError, subprocess.TimeoutExpired):
                process.kill()


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
        guard = getattr(self.backend, "guard", None)
        return {**(meter.report() if meter else {}), **({"free_tier": guard.report()} if guard else {})}


def backend_from_env() -> object:
    """Owner-configured voice. No key means no cloud voice (fail closed)."""
    choice = os.getenv("AI_LIVE_LITE_TTS", "").strip()
    if choice == "azure":
        # The owner's key lives DPAPI-encrypted in the speech key store, not in env.
        from local_agent.speech_credentials import SpeechKeyStore
        from local_agent.security import SecurityError
        store = SpeechKeyStore()
        try:
            record = store.load()
        except SecurityError:
            record = None
        if record is None:
            raise CloudTTSError("TTS_KEY_NOT_CONFIGURED")
        return AzureSpeechBackend(key=record["key"], region=record["region"],
                                  voice=os.getenv("AZURE_SPEECH_VOICE", "th-TH-PremwadeeNeural").strip(),
                                  guard=FreeTierGuard(store.root))
    if choice == "espeak":
        return EspeakTechnicalBackend()
    if choice == "windows":
        return WindowsOneCoreBackend(os.getenv("AI_LIVE_LITE_WINDOWS_VOICE", "").strip())
    raise CloudTTSError("LITE_TTS_NOT_CONFIGURED")
