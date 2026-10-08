"""Thin fail-closed bridge to the SAME TypeScript POST/LIVE ComplianceEngine.

There are deliberately no semantic rules, prohibited words, product facts or
policy interpretations in this module. The trusted engine transport supplies a
bound decision and owns signed packs plus its offline last-known-good registry.
"""
from __future__ import annotations

import hashlib
import json
import threading
import time
import uuid
from dataclasses import dataclass
from typing import Protocol


class ComplianceSpeechError(RuntimeError):
    def __init__(self, code: str = "LIVE_COMPLIANCE_UNAVAILABLE"):
        super().__init__(code)
        self.code = code


class ComplianceTransport(Protocol):
    def authorize(self, request: dict[str, object], *, timeout_seconds: float,
                  cancel_event: threading.Event) -> dict[str, object]: ...


def speech_request_hash(request: dict[str, object]) -> str:
    return hashlib.sha256(json.dumps(request, ensure_ascii=False, sort_keys=True,
                                    separators=(",", ":"), allow_nan=False).encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class AuthorizedSpeech:
    text: str
    policy_version: str
    request_hash: str


class LocalSpeechGate:
    """One bounded authority operation; a stuck transport cannot build a thread queue."""
    def __init__(self, transport: ComplianceTransport | None = None, *, timeout_seconds: float = 1):
        if not 0.01 <= timeout_seconds <= 5:
            raise ValueError("INVALID_COMPLIANCE_DEADLINE")
        self.transport = transport
        self.timeout = timeout_seconds
        self._pending: threading.Thread | None = None
        self._lock = threading.Lock()
        self._quarantined = False

    def health(self) -> dict[str, object]:
        with self._lock:
            ready = self.transport is not None and not self._quarantined
        check = getattr(self.transport, "health", None)
        if ready and callable(check):
            try:
                ready = check().get("ready") is True
            except Exception:
                ready = False
        return {"ready": ready, "code": "READY" if ready else "LIVE_COMPLIANCE_UNAVAILABLE"}

    def close(self):
        close = getattr(self.transport, "close", None)
        if callable(close):
            close()

    def authorize(self, text: str, scope, product_id: str | None, context_version: str,
                  *, cancel_event: threading.Event | None = None, unchanged: bool = False) -> AuthorizedSpeech:
        if (not isinstance(text, str) or not text.strip() or len(text) > 4_000
                or not isinstance(context_version, str) or not context_version
                or (product_id is not None and (not isinstance(product_id, str) or not product_id))):
            raise ComplianceSpeechError("LIVE_COMPLIANCE_INVALID")
        caller_cancel = cancel_event or threading.Event()
        cancellation = threading.Event()
        if caller_cancel.is_set() or self.transport is None:
            raise ComplianceSpeechError()
        request = {"requestId": str(uuid.uuid4()), "ownerId": scope.owner_id,
                   "accountId": scope.account_id, "roomId": scope.room_id,
                   "productId": product_id, "contextVersion": context_version, "text": text}
        request_hash = speech_request_hash(request)
        done = threading.Event()
        results: list[object] = []

        def evaluate() -> None:
            try:
                results.append(self.transport.authorize(request, timeout_seconds=self.timeout,
                                                        cancel_event=cancellation))
            except Exception:
                results.append(None)  # Never expose raw bridge/provider errors to the customer.
            finally:
                with self._lock:
                    self._pending = None
                    self._quarantined = False
                done.set()

        with self._lock:
            if self._pending is not None and self._pending.is_alive():
                raise ComplianceSpeechError()
            self._pending = threading.Thread(target=evaluate, daemon=True, name="live-compliance-authority")
            self._pending.start()
        deadline = time.monotonic() + self.timeout
        while not done.wait(min(0.01, max(0, deadline - time.monotonic()))):
            if caller_cancel.is_set() or time.monotonic() >= deadline:
                cancellation.set()
                with self._lock:
                    self._quarantined = not done.is_set()
                raise ComplianceSpeechError()
        if caller_cancel.is_set() or cancellation.is_set() or time.monotonic() >= deadline:
            cancellation.set()
            raise ComplianceSpeechError()
        response = results[0]
        if (not isinstance(response, dict) or response.get("requestId") != request["requestId"]
                or response.get("requestHash") != request_hash):
            raise ComplianceSpeechError("LIVE_COMPLIANCE_BINDING_INVALID")
        if response.get("allowed") is not True or response.get("finalStatus") not in ("PASS", "PASS_WITH_WARNING"):
            raise ComplianceSpeechError("LIVE_COMPLIANCE_REFUSED")
        safe_text, version = response.get("text"), response.get("policyVersion")
        if (not isinstance(safe_text, str) or not safe_text.strip() or len(safe_text) > 4_000
                or not isinstance(version, str) or not version.strip() or len(version) > 128
                or (unchanged and safe_text != text)):
            raise ComplianceSpeechError("LIVE_COMPLIANCE_BINDING_INVALID")
        return AuthorizedSpeech(safe_text, version, request_hash)
