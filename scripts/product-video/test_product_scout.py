"""Discovery safeguards; fixtures do not establish real product identity or rights."""
import unittest

from product_scout import commercial_candidate, product_image_candidate


class ScoutTests(unittest.TestCase):
    def test_license_allowlist_rejects_noncommercial_and_no_derivatives(self):
        for license_name in ["CC BY-NC 4.0", "CC BY-ND 4.0", "CC BY-SA 4.0 extra", "pd-custom", ""]:
            with self.subTest(license=license_name):
                self.assertFalse(commercial_candidate({"license": license_name}))

    def test_commercial_licenses_remain_candidates_only(self):
        for license_name in ["CC0", "CC0 1.0", "Public domain", "CC BY 4.0", "CC BY-SA 3.0"]:
            with self.subTest(license=license_name):
                self.assertTrue(commercial_candidate({"license": license_name}))

    def test_additional_restrictions_stop_use(self):
        self.assertFalse(commercial_candidate({"license": "CC BY-SA 4.0", "restrictions": "trademarked"}))

    def test_counterfeit_result_seen_in_live_search_is_excluded(self):
        row = {"title": "File:Counterfeit Casio F-91W digital watch.jpg", "license": "CC BY-SA 4.0"}
        self.assertFalse(product_image_candidate(row))
        row["title"] = "File:Casio F-91W watch (2023).jpg"
        self.assertTrue(product_image_candidate(row))


if __name__ == "__main__":
    unittest.main()
