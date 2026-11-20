from __future__ import annotations
import sys
import unicodedata
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from thai_speech import estimate_duration, normalize_thai_speech, sentence_chunks, thai_integer


class ThaiSpeechTests(unittest.TestCase):
    def test_prices_units_percent_and_thai_digits(self):
        self.assertEqual(normalize_thai_speech("ราคา 1,290 บาท ขนาด 250 ml ลด 15%"),
                         "ราคา หนึ่งพันสองร้อยเก้าสิบ บาท ขนาด สองร้อยห้าสิบ มิลลิลิตร ลด สิบห้า เปอร์เซ็นต์")
        self.assertEqual(normalize_thai_speech("฿๙๙๙ น้ำหนัก 0.5 kg"), "เก้าร้อยเก้าสิบเก้า บาท น้ำหนัก ศูนย์จุดห้า กิโลกรัม")
        self.assertEqual(thai_integer(21), "ยี่สิบเอ็ด")
        self.assertEqual(thai_integer(101), "หนึ่งร้อยเอ็ด")
        self.assertEqual(thai_integer(110), "หนึ่งร้อยสิบ")
        self.assertEqual(thai_integer(1_000_000), "หนึ่งล้าน")

    def test_sku_is_spelled_instead_of_treated_as_price(self):
        spoken = normalize_thai_speech("SKU AB-001 USB Vitamin C")
        self.assertEqual(spoken, "รหัสสินค้า เอ บี ขีด ศูนย์ ศูนย์ หนึ่ง ยู เอส บี Vitamin C")
        self.assertEqual(normalize_thai_speech("เลือก SKU 001"), "เลือก รหัสสินค้า ศูนย์ ศูนย์ หนึ่ง")
        self.assertEqual(normalize_thai_speech("Vitamin C", lexicon={"Vitamin": "วิตามิน", "C": "ซี"}), "วิตามิน ซี")

    def test_input_bounds_controls_and_pronunciation_dictionary(self):
        for bad in ("", " ", "x" * 2001, "สวัสดี\x00", "abc\u202e"):
            with self.assertRaises(ValueError):
                normalize_thai_speech(bad)
        with self.assertRaises(ValueError):
            normalize_thai_speech("hello", lexicon={"hello": ""})
        self.assertIn("กิโลกรัม", normalize_thai_speech("หนัก 2 กก."))

    def test_chunk_boundaries_do_not_detach_thai_marks(self):
        long = "สวัสดีค่ะ" * 90
        chunks = sentence_chunks(long, max_chars=40)
        self.assertGreater(len(chunks), 1)
        self.assertEqual("".join(chunks), long)
        self.assertTrue(all(len(chunk) <= 40 and not unicodedata.category(chunk[0]).startswith("M") for chunk in chunks))
        self.assertEqual(sentence_chunks("สวัสดีค่ะ! ราคาเก้าร้อยบาท.\nส่งฟรีค่ะ"),
                         ("สวัสดีค่ะ!", "ราคาเก้าร้อยบาท.", "ส่งฟรีค่ะ"))
        self.assertGreater(estimate_duration("สวัสดีค่ะ ยินดีต้อนรับค่ะ"), estimate_duration("ค่ะ"))


if __name__ == "__main__":
    unittest.main()
