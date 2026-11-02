"""Flexova signatures (spec section 11; rules in spec/signature.json): a detached compact JWS, signed with
Ed25519 over the exact bytes of META-INF/flexova.json."""

import base64
import hashlib
import json
import os
import re
from dataclasses import dataclass
from typing import Optional

from . import _ed25519
from ._report import Collector, FlexovaError, Report
from ._spec import SIGNATURE
from ._validate import validate
from ._zip import read_zip, write_zip

_SEGMENT = re.compile(r"[A-Za-z0-9_-]*\Z")


@dataclass
class Verification:
    """The outcome of verify(): ok with code None, or the first failing check's code."""

    ok: bool
    code: Optional[str]
    message: str
    kid: Optional[str]
    report: Report


def _b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64u(text: str) -> Optional[bytes]:
    if not _SEGMENT.match(text) or len(text) % 4 == 1:
        return None
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def jwk_thumbprint(jwk: dict) -> str:
    """RFC 7638 thumbprint of an Ed25519 key: the default key ID."""
    canonical = json.dumps({"crv": jwk["crv"], "kty": jwk["kty"], "x": jwk["x"]}, separators=(",", ":"), sort_keys=True)
    return _b64u(hashlib.sha256(canonical.encode("utf-8")).digest())


def generate_key(kid: Optional[str] = None) -> tuple:
    """Return (private_jwk, public_jwk) for a new Ed25519 key."""
    seed = os.urandom(32)
    public = {"kty": "OKP", "crv": "Ed25519", "x": _b64u(_ed25519.public_key(seed))}
    public = {**public, "kid": kid or jwk_thumbprint(public), "use": "sig", "alg": SIGNATURE["algorithms"]["sign"]}
    return {**public, "d": _b64u(seed)}, public


def _entries(data: bytes) -> dict:
    entries = read_zip(bytes(data), Collector())
    if entries is None:
        raise ValueError("not a readable ZIP archive")
    return entries


def sign(data: bytes, private_jwk: dict, *, kid: Optional[str] = None, iat: Optional[int] = None) -> bytes:
    """Sign a valid package. Its manifest lists every entry's hash, so the signature covers them all. Returns the package with
    META-INF/flexova.sig.jws added or replaced. Raises FlexovaError if the package is invalid."""
    report = validate(data)
    if not report.valid:
        raise FlexovaError(report)
    if private_jwk.get("kty") != "OKP" or private_jwk.get("crv") != "Ed25519" or not isinstance(private_jwk.get("d"), str):
        raise ValueError("the signing key must be a private Ed25519 JWK (kty OKP, crv Ed25519, with d)")
    seed = _unb64u(private_jwk["d"])
    if seed is None or len(seed) != 32:
        raise ValueError("the signing key's d is not a 32-byte base64url value")
    public = {"kty": "OKP", "crv": "Ed25519", "x": _b64u(_ed25519.public_key(seed))}
    if "x" in private_jwk and private_jwk["x"] != public["x"]:
        raise ValueError("the signing key's x does not match its d")
    entries = _entries(data)
    manifest = entries[SIGNATURE["signedPath"]]
    header = {"alg": SIGNATURE["algorithms"]["sign"], "kid": kid or private_jwk.get("kid") or jwk_thumbprint(public)}
    if iat is not None:
        header["iat"] = int(iat)
    head = _b64u(json.dumps(header, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
    signature = _ed25519.sign(seed, f"{head}.{_b64u(manifest)}".encode("ascii"))
    entries[SIGNATURE["path"]] = f"{head}..{_b64u(signature)}\n".encode("ascii")
    mimetype = entries.pop("mimetype")
    return write_zip([("mimetype", mimetype, False)] + [(n, entries[n], True) for n in sorted(entries)])


def _reject_constant(name: str):
    raise ValueError(f"{name} is not JSON")  # strict JSON, as in JavaScript


def _parse(raw: bytes):
    """Return (header, signing_input_prefix, signature) or None if the file is malformed."""
    if len(raw) > SIGNATURE["maxBytes"]:
        return None
    try:
        text = raw.decode("ascii")
    except UnicodeDecodeError:
        return None
    if text.endswith("\n"):
        text = text[:-1]
    parts = text.split(".")
    if len(parts) != 3 or parts[1] != "" or not parts[0]:
        return None
    head, sig = _unb64u(parts[0]), _unb64u(parts[2])
    if head is None or sig is None:
        return None
    try:
        header = json.loads(head.decode("utf-8"), parse_constant=_reject_constant)
    except (UnicodeDecodeError, ValueError, RecursionError):
        return None
    rules = SIGNATURE["header"]
    if not isinstance(header, dict) or any(name in header for name in rules["forbidden"]):
        return None
    if not isinstance(header.get("alg"), str) or not isinstance(header.get("kid"), str) or not header["kid"]:
        return None
    if "typ" in header and not isinstance(header["typ"], str):
        return None
    if "iat" in header:
        iat = header["iat"]
        if isinstance(iat, bool) or not isinstance(iat, (int, float)) or iat < 0 or not float(iat).is_integer():
            return None
    return header, parts[0], sig


def _usable(key, kid: str) -> Optional[bytes]:
    if not isinstance(key, dict) or key.get("kid") != kid:
        return None
    want = SIGNATURE["key"]
    if key.get("kty") != want["kty"] or key.get("crv") != want["crv"] or not isinstance(key.get("x"), str):
        return None
    if "use" in key and key["use"] != want["use"]:
        return None
    if "key_ops" in key and (not isinstance(key["key_ops"], list) or "verify" not in key["key_ops"]):
        return None
    if "alg" in key and key["alg"] not in SIGNATURE["algorithms"]["verify"]:
        return None
    x = _unb64u(key["x"])
    return x if x is not None and len(x) == 32 else None


def verify(data: bytes, keys) -> Verification:
    """Verify a package's signature against trusted keys (a JWKS dict or a list of JWKs). Never raises for
    malformed packages or signatures; the result carries the first failing check's code."""
    report = validate(data)
    key_list = keys.get("keys", []) if isinstance(keys, dict) else list(keys)

    def result(code: Optional[str], kid: Optional[str] = None) -> Verification:
        message = SIGNATURE["codes"][code]["message"] if code else "The signature is valid."
        return Verification(code is None, code, message, kid, report)

    if not report.valid:
        return result("SIG_PACKAGE_INVALID")
    entries = _entries(data)
    raw = entries.get(SIGNATURE["path"])
    if raw is None:
        return result("SIG_MISSING")
    parsed = _parse(raw)
    if parsed is None:
        return result("SIG_MALFORMED")
    header, head, signature = parsed
    kid = header["kid"]
    if header["alg"] not in SIGNATURE["algorithms"]["verify"]:
        return result("SIG_ALGORITHM", kid)
    manifest = entries[SIGNATURE["signedPath"]]
    candidates = [x for x in (_usable(k, kid) for k in key_list) if x is not None]
    if not candidates:
        return result("SIG_UNKNOWN_KEY", kid)
    message = f"{head}.{_b64u(manifest)}".encode("ascii")
    if not any(_ed25519.verify(x, message, signature) for x in candidates):
        return result("SIG_INVALID", kid)
    return result(None, kid)
