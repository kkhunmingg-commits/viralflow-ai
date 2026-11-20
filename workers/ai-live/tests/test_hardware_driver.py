"""Trusted profile driver minimum and human-facing hardware guidance."""
import sys
import unittest
from dataclasses import replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from local_agent.hardware import HardwareSnapshot, HardwareTiers, assess_hardware, driver_meets_minimum


class DriverGateTests(unittest.TestCase):
    def setUp(self):
        self.snapshot = HardwareSnapshot("Windows", "11", "CPU", 32, "NVIDIA GPU", 16,
                                         "555.1", 8.6, True, True, 100, 1)

    def test_driver_numeric_order_and_unknown_are_not_presence_checks(self):
        self.assertTrue(driver_meets_minimum("555.1", "551.61"))
        self.assertTrue(driver_meets_minimum("551.61", "551.61"))
        self.assertFalse(driver_meets_minimum("551.9", "551.61"))
        for actual in (None, "", "unknown", "555.1 rc1", "https://driver.invalid"):
            self.assertFalse(driver_meets_minimum(actual, "551.61"))
        with self.assertRaises(ValueError):
            HardwareTiers(minimum_driver_version="newest")

    def test_outdated_driver_blocks_and_offers_fixed_official_action(self):
        assessment = assess_hardware(replace(self.snapshot, driver_version="550.54"),
                                     HardwareTiers(minimum_driver_version="551.61"))
        self.assertFalse(assessment.compatible)
        self.assertTrue(assessment.validation_required)
        self.assertIn("NVIDIA_DRIVER_REQUIRED", assessment.diagnostics["codes"])
        customer = assessment.customer()
        self.assertEqual(customer["driverAction"]["url"], "https://www.nvidia.com/Download/index.aspx")
        self.assertTrue(customer["advice"])
        self.assertNotIn("CUDA", str(customer))
        self.assertNotIn("550.54", str(customer))
        self.assertNotIn("551.61", str(customer))

    def test_supported_driver_still_needs_real_validation(self):
        assessment = assess_hardware(self.snapshot, HardwareTiers(minimum_driver_version="551.61"))
        self.assertTrue(assessment.compatible)
        self.assertTrue(assessment.validation_required)
        self.assertIsNone(assessment.customer()["driverAction"])
        self.assertEqual(assessment.diagnostics["marker"], "GPU_VALIDATION_REQUIRED")

    def test_old_gpu_is_not_presented_as_fixable_by_driver_update(self):
        assessment = assess_hardware(replace(self.snapshot, compute_capability=5.0),
                                     HardwareTiers(minimum_driver_version="551.61"))
        self.assertFalse(assessment.compatible)
        self.assertIn("GPU_MODEL_REQUIRED", assessment.diagnostics["codes"])
        self.assertIsNone(assessment.customer()["driverAction"])


if __name__ == "__main__":
    unittest.main()
