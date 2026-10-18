"""LIVE Lite show director: keeps the AI presenter talking with no human host.

It only feeds LIVE Pro's LocalAISession.queue_speech with lines built from
the synced product facts, and rotates the featured product. Viewer comments
still outrank script lines (the session's own priority queue), so the
presenter stops pitching to answer and then carries on.
"""
from __future__ import annotations

import math
import threading
import time

from local_brain import _list_text, _safe_text

SCRIPT_PRIORITY = 10  # below every comment priority in local_ai_session.comment_priority


def _price_text(facts) -> str | None:
    price, currency = facts.get("price"), facts.get("currency", "THB")
    if type(price) not in (int, float) or not math.isfinite(price) or not 0 <= price <= 100_000_000 or currency != "THB":
        return None
    amount = f"{price:,.2f}".rstrip("0").rstrip(".") if type(price) is float else f"{price:,}"
    return f"ราคาตอนนี้ {amount} บาทค่ะ"


def product_script(name: str, facts) -> list[str]:
    """Spoken lines from approved facts only; a missing fact is simply not said."""
    lines = [f"ตอนนี้มาดู {name} กันนะคะ" if _safe_text(name) else "มาดูสินค้าตัวนี้กันนะคะ"]
    price = _price_text(facts)
    if price:
        lines.append(price)
    promotion = _safe_text(facts.get("promotion"))
    if promotion:
        lines.append(promotion)
    attributes = facts.get("attributes")
    if isinstance(attributes, dict):
        for key, value in list(attributes.items())[:3]:
            value = _safe_text(value)
            if isinstance(key, str) and value:
                lines.append(value)
    colors, sizes = _list_text(facts.get("colors")), _list_text(facts.get("sizes"))
    if colors:
        lines.append(f"มีให้เลือกสี {colors} ค่ะ")
    if sizes:
        lines.append(f"มีขนาด {sizes} ค่ะ")
    shipping = _safe_text(facts.get("shipping"))
    if shipping:
        lines.append(shipping)
    stock = facts.get("stock")
    if type(stock) is int and 0 < stock <= 100_000_000:
        lines.append(f"ตอนนี้มีของพร้อมส่ง {stock:,} ชิ้นค่ะ")
    lines.append(_safe_text(facts.get("purchase")) or "สนใจกดตะกร้าด้านล่างได้เลยนะคะ")
    lines.append("มีคำถามพิมพ์มาในคอมเมนต์ได้เลยค่ะ")
    return lines


class LiteShowDirector:
    def __init__(self, session, *, seconds_per_product: float = 180, idle_gap_seconds: float = 1.5,
                 clock=time.monotonic):
        if not 20 <= seconds_per_product <= 3600 or not 0 <= idle_gap_seconds <= 30:
            raise ValueError("INVALID_LITE_DIRECTOR_CONFIG")
        self.session = session
        self.seconds_per_product = seconds_per_product
        self.idle_gap = idle_gap_seconds
        self._clock = clock
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._index = 0
        self._line = 0
        self._counter = 0
        self._product_started = clock()
        self._quiet_since: float | None = None
        self.lines_queued = 0
        self.rotations = 0

    def start(self) -> None:
        if self._thread is None:
            self._thread = threading.Thread(target=self._run, name="lite-show-director", daemon=True)
            self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread and self._thread is not threading.current_thread():
            self._thread.join(timeout=2)

    def _product(self):
        ids = self.session.product_ids
        if not ids:
            return None
        product_id = ids[self._index % len(ids)]
        return self.session.product_store.fetch(self.session.scope, product_id)

    def step(self) -> bool:
        """One scheduling decision; returns True when a line was queued."""
        snapshot = self.session.snapshot()
        busy = (self.session.speaking or snapshot["paused"] or snapshot["comment_queue_depth"]
                or snapshot["speech_queue_depth"])
        now = self._clock()
        if busy:
            self._quiet_since = None
            return False
        if self._quiet_since is None:
            self._quiet_since = now
        if now - self._quiet_since < self.idle_gap:
            return False
        product = self._product()
        if product is None:
            return False
        script = product_script(product.name, product.facts)
        if self._line >= len(script):
            self._line = 0
            if len(self.session.product_ids) > 1 and now - self._product_started >= self.seconds_per_product:
                self._index += 1
                self.rotations += 1
                self._product_started = now
                product = self._product()
                if product is None:
                    return False
                script = product_script(product.name, product.facts)
        self.session.current_product_id = product.product_id
        self._counter += 1
        queued = self.session.queue_speech(f"lite-script-{self._counter}", script[self._line],
                                           priority=SCRIPT_PRIORITY, product_id=product.product_id)
        if queued:
            self._line += 1
            self.lines_queued += 1
            self._quiet_since = None
        return queued

    def _run(self) -> None:
        while not self._stop.wait(0.25):
            try:
                self.step()
            except Exception:
                # The director must never take the presenter or stream down.
                continue

    def metrics(self) -> dict[str, object]:
        return {"lines_queued": self.lines_queued, "rotations": self.rotations,
                "current_product_id": self.session.current_product_id}
