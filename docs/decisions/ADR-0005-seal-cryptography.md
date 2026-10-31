# ADR-0005: Flexova Seal cryptography (implementation at milestone M8)

- **Status:** Accepted, 2026-10-31.

## Decision

- **Data key:** one random 256-bit data key (DEK) per document revision.
- **Entries:** each entry is AES-256-GCM(DEK, random 96-bit IV, AAD = UTF-8(entry path)), stored as IV ‖ ciphertext ‖ tag under an opaque name, so titles and file names don't leak.
- **Keyring:** an **RFC 7516 JWE** (General or Flattened JSON) with `enc: A256GCM`. Its payload is `{dek, spine, assets, private metadata, policy}`.
- **Recipients:** a strict allowlist; everything else is ignored:
  - `PBES2-HS512+A256KW`: generated passphrase, **p2c = 600,000**. Readers accept **100,000–2,000,000** and reject anything outside that range, which blocks downgrades and denial of service.
  - `ECDH-ES+A256KW` (P-256): organization recovery key, device keys.
  - `A256KW`: link key carried in the URL `#fragment`.
  - Later: `x-flexova-kms` (L2 key server) and `x-flexova-prf` (passkey PRF, FlexPad origin only).
- **Rejected inputs:** headers with `zip`, `crit` or external `aad`.
- **Normalization:** passphrases are NFKC-normalized on both sides.
- **Primitives:** WebCrypto only, so there are no crypto dependencies in browsers.

## Evidence (`prototypes/poc/fdoc-jwe.mjs`, `jwe-interop.*`)

- **Interop:** our ~120-line implementation interoperates with `jose` (Node) and `jwcrypto` (Python) in both directions, for passphrase and EC recipients: 20/20 checks.
- **Library defaults are a trap:**
  - `jose` 5.9.6's multi-recipient encrypt **hard-codes p2c = 2048**;
  - decrypt caps are 10,000 in `jose` and 16,384 in `jwcrypto`.

  Our encoder must set p2c itself, and SDK docs must show how to raise the caps.

- **Hostile inputs rejected:** wrong passphrase, p2c = 10⁹, p2c = 1000, `alg=dir`, `zip`, off-curve ephemeral key, entry moved to another path.
- **Key format interop:** WebCrypto-exported JWKs carry `key_ops: ["deriveBits"]`, which jwcrypto rejects for ECDH-ES. Strip `key_ops`/`ext` when exchanging keys.

## Consequences

- **Review before release:** an external security review and published test vectors are required before Seal ships.
- **Recovery recipient:** organization-sealed documents include an organization recovery recipient (public key only on build machines).
