# ADR-0009: Open-core licensing and repository split

- **Status:** Accepted, 2026-10-31 (product owner decision).

## Decision

- **This repository (`flexova`, public):**
  - code under **Apache-2.0** (patent grant, business-friendly);
  - specification (`spec/`) under **CC-BY-4.0**.
- **`flexpad` (private, separate repository):** the FlexPad reader and editor are **proprietary**. FlexPad depends on published `@flexova/*` packages, never on unpublished code here.
- **Seal and any future controlled-access server:**
  - the Seal extension spec and SDK code are open, in this repository;
  - hosted services may be proprietary.

## Consequences

- **Integrators and alternative readers can adopt Flexova freely,** which drives format adoption, while FlexPad remains a product.
- **Nothing FlexPad-specific lands here.** If FlexPad needs a format feature, it goes through the spec first.
