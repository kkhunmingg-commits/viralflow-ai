"""Real Node Ed25519 signer to Python verifier contract test.

The normal dependency-free Python suite skips this when cryptography or Node is
not installed. The release build must run it in its packaged Python runtime.
"""

from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from local_agent.security import SecurityError, verify_grant  # noqa: E402
from test_local_agent import ACCOUNT, DEVICE, OWNER_A, PRODUCT, VERSIONS  # noqa: E402

NODE_SIGNER = r"""
const { generateKeyPairSync, sign } = require('node:crypto');
const fs = require('node:fs');
const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => [key, sorted(item)]));
  }
  return value;
}
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const canonical = Buffer.from(JSON.stringify(sorted(payload)), 'utf8');
process.stdout.write(JSON.stringify({
  payload,
  signature: sign(null, canonical, privateKey).toString('base64url'),
  publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
}));
"""


class CrossLanguageSignatureTests(unittest.TestCase):
    @unittest.skipUnless(importlib.util.find_spec("cryptography") and shutil.which("node"),
                         "Node and packaged cryptography runtime are required")
    def test_node_ed25519_signature_verifies_in_python_and_detects_tampering(self) -> None:
        payload = {
            "v": 1, "ownerId": OWNER_A, "deviceId": DEVICE,
            "challenge": "A" * 43, "accountId": ACCOUNT,
            "productIds": [PRODUCT], "grantId": "ffffffff-ffff-4fff-8fff-ffffffffffff",
            "issuedAt": 1000, "expiresAt": 1120, "entitled": True,
            "versions": VERSIONS.copy(),
        }
        process = subprocess.run(
            [shutil.which("node"), "-e", NODE_SIGNER], input=json.dumps(payload),
            text=True, capture_output=True, timeout=10, check=True, shell=False,
        )
        signed = json.loads(process.stdout)
        public_key = signed.pop("publicKeyPem").encode("ascii")
        grant = verify_grant(signed, public_key, now=1000)
        self.assertEqual(grant.owner_id, OWNER_A)
        self.assertEqual(grant.device_id, DEVICE)
        self.assertEqual(grant.product_ids, (PRODUCT,))
        signed["payload"]["ownerId"] = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        with self.assertRaises(SecurityError) as tampered:
            verify_grant(signed, public_key, now=1000)
        self.assertEqual(tampered.exception.code, "INVALID_SIGNATURE")


if __name__ == "__main__":
    unittest.main()
