"""Model-independent Thai commerce speech normalization, entirely offline.

Ordinary English words are retained unless the account supplies a pronunciation
dictionary. Product identifiers are spelled out, never interpreted as prices.
This changes pronunciation only; it never invents product facts.
"""
from __future__ import annotations

import re
import unicodedata
from collections.abc import Mapping

MAX_SPEECH_TEXT = 2_000
NORMALIZER_VERSION = "thai-commerce-v1"
_DIGITS = ("ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า")
_LETTERS = dict(zip("ABCDEFGHIJKLMNOPQRSTUVWXYZ", (
    "เอ", "บี", "ซี", "ดี", "อี", "เอฟ", "จี", "เอช", "ไอ", "เจ", "เค", "แอล", "เอ็ม",
    "เอ็น", "โอ", "พี", "คิว", "อาร์", "เอส", "ที", "ยู", "วี", "ดับเบิลยู", "เอ็กซ์", "วาย", "แซด")))
_UNITS = {"ml": "มิลลิลิตร", "mL": "มิลลิลิตร", "l": "ลิตร", "L": "ลิตร", "kg": "กิโลกรัม",
          "g": "กรัม", "mg": "มิลลิกรัม", "cm": "เซนติเมตร", "mm": "มิลลิเมตร", "km": "กิโลเมตร",
          "m": "เมตร", "GB": "กิกะไบต์", "MB": "เมกะไบต์", "บาท": "บาท", "%": "เปอร์เซ็นต์"}
_NUMBER = r"[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?"
_IDENTIFIER = re.compile(r"\b[A-Za-z0-9]+(?:[-_/][A-Za-z0-9]+)*\b")


def thai_integer(value: int) -> str:
    if value < 0:
        return "ลบ" + thai_integer(-value)
    if value == 0:
        return _DIGITS[0]
    if value >= 1_000_000:
        quotient, remainder = divmod(value, 1_000_000)
        return thai_integer(quotient) + "ล้าน" + (thai_integer(remainder) if remainder else "")
    digits = str(value)
    output = []
    for index, digit in enumerate(digits):
        amount, place = int(digit), len(digits) - index - 1
        if not amount:
            continue
        if place == 1:
            output.append(("" if amount == 1 else "ยี่" if amount == 2 else _DIGITS[amount]) + "สิบ")
        elif place == 0:
            # 101, 1001 and 1,000,001 end in เอ็ด, but 1 itself is หนึ่ง.
            output.append("เอ็ด" if amount == 1 and value > 1 else _DIGITS[amount])
        else:
            output.append(_DIGITS[amount] + {2: "ร้อย", 3: "พัน", 4: "หมื่น", 5: "แสน"}[place])
    return "".join(output)


def thai_number(value: str) -> str:
    value = value.replace(",", "")
    sign = "ลบ" if value.startswith("-") else ""
    value = value.lstrip("+-")
    integer, dot, decimal = value.partition(".")
    # Extremely long numbers are identifiers rather than unbounded huge ints.
    spoken = " ".join(_DIGITS[int(c)] for c in integer) if len(integer) > 12 else thai_integer(int(integer))
    return sign + spoken + ("จุด" + "".join(_DIGITS[int(c)] for c in decimal) if dot else "")


def spell_identifier(value: str) -> str:
    return " ".join(_LETTERS.get(c.upper(), _DIGITS[int(c)] if c.isascii() and c.isdigit()
                                else "ขีด" if c == "-" else "ทับ" if c == "/" else "ขีดล่าง") for c in value)


def normalize_thai_speech(text: str, *, lexicon: Mapping[str, str] | None = None) -> str:
    if not isinstance(text, str) or not text.strip() or len(text) > MAX_SPEECH_TEXT:
        raise ValueError("INVALID_SPEECH_REQUEST")
    text = unicodedata.normalize("NFC", text).translate(str.maketrans("๐๑๒๓๔๕๖๗๘๙", "0123456789"))
    if any(unicodedata.category(c) in {"Cc", "Cf"} and c not in "\n\r\t" for c in text):
        raise ValueError("INVALID_SPEECH_REQUEST")
    if lexicon:
        if len(lexicon) > 100 or any(not isinstance(k, str) or not k or len(k) > 80
                                   or not isinstance(v, str) or not v.strip() or len(v) > 120 for k, v in lexicon.items()):
            raise ValueError("INVALID_PRONUNCIATION_DICTIONARY")
        for word in sorted(lexicon, key=len, reverse=True):
            text = re.sub(r"(?<![A-Za-z0-9])" + re.escape(word) + r"(?![A-Za-z0-9])", lambda _: lexicon[word], text)
    # Units must run before identifiers (250ml is a quantity, AB250 is a SKU).
    unit_pattern = "|".join(re.escape(unit) for unit in sorted(_UNITS, key=len, reverse=True))
    text = re.sub(r"(?<![A-Za-z0-9])(" + _NUMBER + r")\s*(" + unit_pattern + r")(?![A-Za-z])",
                  lambda m: thai_number(m[1]) + " " + _UNITS[m[2]], text)
    text = re.sub(r"฿\s*(" + _NUMBER + r")", lambda m: thai_number(m[1]) + " บาท", text)
    text = re.sub(r"\bSKU\s*[:：]?\s*([A-Za-z0-9]+(?:[-_/][A-Za-z0-9]+)*)",
                  lambda m: "รหัสสินค้า " + spell_identifier(m[1]), text, flags=re.IGNORECASE)
    def identifier(match: re.Match) -> str:
        value = match[0]
        if any(c.isdigit() for c in value) and any(c.isalpha() for c in value):
            return spell_identifier(value)
        if value.isalpha() and value.isupper() and 2 <= len(value) <= 8:
            return spell_identifier(value)
        return value
    text = _IDENTIFIER.sub(identifier, text)
    text = re.sub(_NUMBER, lambda m: thai_number(m[0]), text)
    for abbreviation, spoken in {"กก.": "กิโลกรัม", "มล.": "มิลลิลิตร", "ซม.": "เซนติเมตร",
                                 "พ.ศ.": "พุทธศักราช", "ค.ศ.": "คริสต์ศักราช"}.items():
        text = text.replace(abbreviation, spoken)
    text = re.sub(r"[“”\"‘’]", "", text)
    text = re.sub(r"[|•]+", " ", text)
    return re.sub(r"[ \t\r]+", " ", text).strip()


def sentence_chunks(text: str, *, max_chars: int = 220) -> tuple[str, ...]:
    """Bounded sentence fragments; never cut a Thai combining mark from its base."""
    if not isinstance(max_chars, int) or not 20 <= max_chars <= 500:
        raise ValueError("INVALID_SENTENCE_LIMIT")
    if not text.strip():
        return ()
    parts = re.split(r"(?<=[.!?。！？])\s*|\n+", text)
    result: list[str] = []
    for part in parts:
        part = part.strip()
        while len(part) > max_chars:
            split = part.rfind(" ", max_chars // 2, max_chars + 1)
            if split < 0:
                split = max_chars
                while split > 0 and unicodedata.category(part[split]).startswith("M"):
                    split -= 1
            if split == 0:
                raise ValueError("INVALID_SENTENCE_BOUNDARY")
            result.append(part[:split].strip())
            part = part[split:].strip()
        if part:
            result.append(part)
    return tuple(result)


def estimate_duration(text: str) -> float:
    """Heuristic scheduling estimate, never a measured benchmark result."""
    normalized = normalize_thai_speech(text)
    thai_bases = sum("\u0e01" <= c <= "\u0e2e" for c in normalized)
    english_words = len(re.findall(r"[A-Za-z]+", normalized))
    return round(max(0.4, thai_bases / 11.0 + english_words / 2.8 + len(sentence_chunks(normalized)) * 0.15), 3)
