# ADR-0016: FlexPad is AGPL-3.0, in a public repository

- **Status:** Accepted, 2026-11-02 (product owner decision).
- **Supersedes** ADR-0009's "`flexpad` (private, separate repository): … proprietary". Everything else in ADR-0009 stands: this repository stays Apache-2.0 (code) and CC-BY-4.0 (spec).

## Decision

- **FlexPad** (`EagleMind/flexpad`) is public and licensed **AGPL-3.0-only**. Its own ADR-0006 records the details.
- **Licenses flow one way:** FlexPad may use flexova code (Apache-2.0 is compatible with AGPL-3.0), but FlexPad code must never be copied into this repository.
- **Until `@flexova/*` 0.1.0 is on npm,** FlexPad vendors tarballs packed from a flexova branch (FlexPad ADR-0004). This is a temporary exception to ADR-0009's "published packages only".

## Consequences

- **Anyone can read, run and modify FlexPad.** Whoever offers a modified FlexPad to others over a network must publish their changes, which deters closed clones of the reader.
- **A commercial license alongside the AGPL** (dual licensing) needs a contributor agreement before outside code is merged; that is an owner decision.
- **Nothing changes for integrators** of the Flexova SDK, viewer or CLI.
