"""Signatures: the shared signature fixtures, RFC 8032 vectors, and sign/verify round trips."""

import json
import unittest
from pathlib import Path

import flexova
from flexova import _ed25519

ROOT = Path(__file__).resolve().parents[2]
SUITE = ROOT / "conformance" / "signatures"
EXPECTED = json.loads((SUITE / "expected.json").read_text("utf-8"))
TRUSTED = json.loads((SUITE / EXPECTED["trustedKeys"]).read_text("utf-8"))

# RFC 8032, section 7.1: (secret key, public key, message, signature).
VECTORS = [
    (
        "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
        "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
        "",
        "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
    ),
    (
        "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb",
        "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c",
        "72",
        "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00",
    ),
    (
        "c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7",
        "fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025",
        "af82",
        "6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac18ff9b538d16f290ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a",
    ),
]


def package() -> bytes:
    return flexova.write({
        "identifier": "urn:uuid:7d1c9f40-1b7a-4c51-9a2e-000000000002",
        "title": "Signed",
        "language": "en",
        "modified": "2026-11-02T00:00:00Z",
        "chapters": [{"title": "One", "body": '<section><h1 id="a">One</h1><p>Text.</p></section>'}],
    })


class Ed25519Test(unittest.TestCase):
    def test_rfc8032_vectors(self):
        for secret, public, message, signature in VECTORS:
            with self.subTest(public=public[:8]):
                seed, msg = bytes.fromhex(secret), bytes.fromhex(message)
                self.assertEqual(_ed25519.public_key(seed).hex(), public)
                self.assertEqual(_ed25519.sign(seed, msg).hex(), signature)
                self.assertTrue(_ed25519.verify(bytes.fromhex(public), msg, bytes.fromhex(signature)))
                self.assertFalse(_ed25519.verify(bytes.fromhex(public), msg + b"x", bytes.fromhex(signature)))


class SignatureConformanceTest(unittest.TestCase):
    def test_suite_covers_every_code(self):
        codes = {f["code"] for f in EXPECTED["fixtures"].values()}
        spec = json.loads((ROOT / "spec" / "signature.json").read_text("utf-8"))
        self.assertEqual(codes - {None}, set(spec["codes"]))
        self.assertIn(None, codes)

    def test_every_fixture(self):
        for rel, want in EXPECTED["fixtures"].items():
            with self.subTest(fixture=rel):
                result = flexova.verify((SUITE.parent / rel).read_bytes(), TRUSTED)
                self.assertEqual(result.code, want["code"])
                self.assertEqual(result.ok, want["code"] is None)


class SignTest(unittest.TestCase):
    def test_round_trip_and_tamper(self):
        private, public = flexova.generate_key()
        self.assertNotIn("d", public)
        self.assertEqual(public["kid"], flexova.jwk_thumbprint(public))
        signed = flexova.sign(package(), private)
        self.assertTrue(flexova.validate(signed).valid)
        result = flexova.verify(signed, {"keys": [public]})
        self.assertTrue(result.ok, result.message)
        self.assertEqual(result.kid, public["kid"])
        self.assertEqual(flexova.verify(signed, [{**public, "x": flexova.generate_key()[1]["x"]}]).code, "SIG_INVALID")
        self.assertEqual(flexova.verify(package(), [public]).code, "SIG_MISSING")

    def test_signing_is_deterministic_and_replaces_old_signature(self):
        private, public = flexova.generate_key("k1")
        once = flexova.sign(package(), private, iat=1793491200)
        self.assertEqual(once, flexova.sign(package(), private, iat=1793491200))
        other, other_public = flexova.generate_key("k2")
        twice = flexova.sign(once, other)
        self.assertEqual(flexova.verify(twice, [public]).code, "SIG_UNKNOWN_KEY")
        self.assertTrue(flexova.verify(twice, [public, other_public]).ok)

    def test_refuses_invalid_input(self):
        private, _ = flexova.generate_key()
        with self.assertRaises(flexova.FlexovaError):
            flexova.sign(b"not a package", private)
        with self.assertRaises(ValueError):
            flexova.sign(package(), {"kty": "OKP", "crv": "Ed25519", "x": private["x"]})


if __name__ == "__main__":
    unittest.main()
