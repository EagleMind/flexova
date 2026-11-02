# Architecture decision records

Each ADR records one decision: its context, what was decided, the consequences, and the evidence. **Read the relevant ADRs before changing anything they cover.** To change a decision, add a new ADR that supersedes the old one. Never edit an accepted ADR's decision in place.

| ADR                                                     | Decision                                                                                                                                  |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [0001](ADR-0001-naming.md)                              | Name: Flexova, `.flexova`, `application/vnd.flexova+zip`; reader/editor FlexPad                                                           |
| [0002](ADR-0002-content-model-xhtml-profile.md)         | Content is a strict XHTML profile, not a custom JSON tree or Markdown                                                                     |
| [0003](ADR-0003-epub-container.md)                      | Container is EPUB 3.3 OCF; unencrypted files are valid EPUBs                                                                              |
| [0004](ADR-0004-no-encryption-in-core.md)               | No encryption in the core format; Seal is an optional extension; controlled access is a service                                           |
| [0005](ADR-0005-seal-cryptography.md)                   | Seal uses a JWE subset plus per-entry AES-256-GCM, with bounded PBES2 iterations                                                          |
| [0006](ADR-0006-static-first-html-and-distribution.md)  | Single-file HTML is static-first; distribution order                                                                                      |
| [0007](ADR-0007-viewer-web-component.md)                | Viewer is a web component: Shadow DOM, rebuild from an allowlist, tokens as data, no network                                              |
| [0008](ADR-0008-rules-as-data-conformance.md)           | Rules are data plus a shared conformance suite; Rust core deferred                                                                        |
| [0009](ADR-0009-open-core-licensing.md)                 | Open core: Apache-2.0 SDK, CC-BY-4.0 spec, proprietary FlexPad in its own repo                                                            |
| [0010](ADR-0010-flexpad-offline-first.md)               | FlexPad is offline-first, web app first; the file is the source of truth                                                                  |
| [0011](ADR-0011-signatures.md)                          | Signatures: optional detached JWS (Ed25519)                                                                                               |
| [0012](ADR-0012-toolchain.md)                           | Toolchain: pnpm, TypeScript 6.0 (pinned), tsup, Vitest, ESLint, Changesets, Node 22                                                       |
| [0013](ADR-0013-validation-rules-from-m1.md)            | Validation rules decided in M1: code sets, trailing deflate bytes, JSON depth, no DTDs, ASCII names, DPUB roles, SHA-256 fallback         |
| [0014](ADR-0014-renderers-from-m2.md)                   | Rendering decisions from M2: viewer budget 8 KB (supersedes ADR-0007's 6 KB), shared rebuild core, id namespacing, reversible static HTML |
| [0015](ADR-0015-m3-signatures-importers-cli-release.md) | M3: signature format (compact detached JWS, alg Ed25519), mdast and Pandoc-JSON importers, reproducible CLI builds, OIDC releases         |
| [0016](ADR-0016-flexpad-agpl-public.md)                 | FlexPad is AGPL-3.0 in a public repository (supersedes ADR-0009's proprietary FlexPad)                                                    |
