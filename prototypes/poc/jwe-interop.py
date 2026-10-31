"""jwcrypto side of the interop matrix: decrypt our JWE (passphrase + EC key), then seal one for us to open."""
import json
import sys

import jwcrypto.jwa as jwa
from jwcrypto import jwe, jwk

jwe_path, priv_path, passphrase, expected_dek = sys.argv[1:5]
results = {}
doc = open(jwe_path).read()


def try_decrypt(name, key):
    try:
        j = jwe.JWE()
        j.deserialize(doc, key=key)
        ok = json.loads(j.payload)["dek"] == expected_dek
        results[name] = "ok" if ok else "FAIL (dek mismatch)"
    except Exception as e:  # noqa: BLE001
        results[name] = f"rejected: {type(e).__name__}: {e}"


try_decrypt("ours→jwcrypto with DEFAULT cap (16384)", jwk.JWK.from_password(passphrase))
if results["ours→jwcrypto with DEFAULT cap (16384)"].startswith("rejected"):
    results["ours→jwcrypto with DEFAULT cap (16384)"] = "ok (rejected as expected: cap too low)"
jwa.default_max_pbkdf2_iterations = 2_000_000
try_decrypt("ours→jwcrypto (passphrase, cap raised)", jwk.JWK.from_password(passphrase))
try_decrypt("ours→jwcrypto (org recovery key)", jwk.JWK(**{k: v for k, v in json.loads(open(priv_path).read()).items() if k not in ("key_ops", "ext")}))

# jwcrypto seals a flattened JWE with an explicit, strong p2c
out = jwe.JWE(json.dumps({"v": 1, "dek": expected_dek}).encode(), protected=json.dumps({"enc": "A256GCM"}))
out.add_recipient(jwk.JWK.from_password(passphrase), header=json.dumps({"alg": "PBES2-HS512+A256KW", "p2c": 600_000}))
print(json.dumps({"results": results, "jwe": json.loads(out.serialize())}))
