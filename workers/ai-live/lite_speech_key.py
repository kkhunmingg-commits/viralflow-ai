"""Owner-only setup of the LIVE Lite cloud voice key (Azure AI Speech, F0 free tier).

    python lite_speech_key.py set --region southeastasia   # masked prompt on this PC
    python lite_speech_key.py status
    python lite_speech_key.py test --voice th-TH-PremwadeeNeural --out sample.wav
    python lite_speech_key.py delete

The key is typed into a masked prompt on the owner's own Windows session and
stored DPAPI-encrypted for that Windows user. It is never printed, logged,
put in environment variables or sent anywhere except Azure's TTS endpoint.
"""
from __future__ import annotations

import argparse
import getpass
import json
import sys
import threading
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from cloud_tts import AzureSpeechBackend, CloudTTSError, FreeTierGuard  # noqa: E402
from local_agent.security import SecurityError  # noqa: E402
from local_agent.speech_credentials import SpeechKeyStore  # noqa: E402

THAI_VOICES = ("th-TH-PremwadeeNeural", "th-TH-AcharaNeural", "th-TH-NiwatNeural")


def _masked_prompt(title: str) -> str:
    try:
        import tkinter as tk
        from tkinter import simpledialog
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        value = simpledialog.askstring(title, "วาง Key 1 ของ Azure Speech (F0) แล้วกด OK", show="*", parent=root)
        root.destroy()
        return (value or "").strip()
    except Exception:
        return getpass.getpass(title + ": ").strip()


def _synthesize(record: dict, voice: str, text: str, store: SpeechKeyStore) -> bytes:
    backend = AzureSpeechBackend(key=record["key"], region=record["region"], voice=voice,
                                 guard=FreeTierGuard(store.root))
    return b"".join(backend.stream_sentence(text, threading.Event()))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    setter = sub.add_parser("set")
    setter.add_argument("--region", required=True, help="Azure region of the Speech resource, e.g. southeastasia")
    sub.add_parser("status")
    tester = sub.add_parser("test")
    tester.add_argument("--voice", choices=THAI_VOICES, default=THAI_VOICES[0])
    tester.add_argument("--text", default="สวัสดีค่ะ ยินดีต้อนรับเข้าสู่ไลฟ์ทดสอบนะคะ")
    tester.add_argument("--out", type=Path)
    sub.add_parser("delete")
    args = parser.parse_args()
    store = SpeechKeyStore()
    try:
        if args.command == "set":
            key = _masked_prompt("ViralFlow LIVE Lite - Azure Speech key")
            if not key:
                print(json.dumps({"stored": False, "reason": "NO_KEY_ENTERED"}))
                return 1
            # Verify before storing: one short phrase (counted against the F0 ledger).
            _synthesize({"key": key, "region": args.region}, THAI_VOICES[0], "ทดสอบค่ะ", store)
            store.put("azure", key, args.region)
            key = ""
            print(json.dumps({"stored": True, "verified": True, **store.metadata()}, ensure_ascii=False))
        elif args.command == "status":
            guard = FreeTierGuard(store.root)
            print(json.dumps({**store.metadata(), "free_tier": guard.report()}, ensure_ascii=False))
        elif args.command == "test":
            record = store.load()
            if record is None:
                raise CloudTTSError("TTS_KEY_NOT_CONFIGURED")
            pcm = _synthesize(record, args.voice, args.text, store)
            if args.out:
                with wave.open(str(args.out), "wb") as handle:
                    handle.setnchannels(1)
                    handle.setsampwidth(2)
                    handle.setframerate(16000)
                    handle.writeframes(pcm)
            print(json.dumps({"ok": True, "voice": args.voice, "seconds": round(len(pcm) / 32000, 2),
                              "characters": len(args.text)}, ensure_ascii=False))
        else:
            store.delete()
            print(json.dumps({"deleted": True}))
        return 0
    except (CloudTTSError, SecurityError) as exc:
        print(json.dumps({"ok": False, "code": exc.code}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
