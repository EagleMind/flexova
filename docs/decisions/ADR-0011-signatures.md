# ADR-0011: Optional detached signatures

- **Status:** Accepted, 2026-10-31.

## Decision

- **Where:** a package may carry `META-INF/flexova.sig.jws`, a detached **JWS (RFC 7515) using EdDSA/Ed25519** over the exact bytes of the Flexova manifest, which lists the SHA-256 of every entry as stored.
- **Publisher keys:** published as a JWKS at `https://<publisher-domain>/.well-known/flexova/jwks.json`.
- **Optional on both sides:** producing and verifying are both optional; viewers that don't verify ignore the file.
- **The signature covers stored bytes,** so for sealed files that means ciphertext. A gateway can check authenticity without the key.
- **A self-contained HTML file can't vouch for itself:** anyone can swap its loader. Meaningful verification happens in an independent reader (FlexPad, the CLI) that shows the verified signer's domain.

## Evidence

Ed25519 sign/verify works in WebCrypto (verified in Chromium 153). ECDSA P-256 is the fallback for older engines.

## Consequences

- **Offline verification uses cached publisher keys:** key revocation can't be checked offline.
- **Ships in M3** (CLI `sign` / `verify`).
