# ADR-0008: Rules are data plus a shared conformance suite; Rust core deferred

- **Status:** Accepted, 2026-10-31. Supersedes blueprint v3's "Rust core in Phase 2".

## Context

Validation must give identical results in every language. One way is a single Rust core with bindings for every language. That adds a heavy build matrix (wasm-pack, maturin, cross-compilation, C ABI), which doesn't suit a small team.

## Decision

- **Rules as data:** every enforceable rule lives in machine-readable files under `spec/`: `constants.json`, `profile/profile-1.0.json`, and `schema/manifest.schema.json`.
- **Shared conformance suite:** `conformance/{valid,invalid,hostile}` plus `expected.json`, which lists the expected verdict and **error codes** per fixture. Every implementation must pass it.
- **Reference implementations:** TypeScript (`@flexova/core`) and pure-stdlib Python (`flexova`). Because content is XHTML, standard XML parsers are enough.
- **Other languages** integrate through the CLI and Docker image (M3) until demand justifies a native SDK.
- **A Rust core is deferred.** Revisit when native Swift or Kotlin SDKs, or a C ABI, are needed.

## Consequences

- **CI checks agreement:** TS and Python must give identical verdicts on every fixture.
- **Rule changes are data changes:** add or change the rule in `spec/`, add fixtures, and update every implementation in the same PR.
