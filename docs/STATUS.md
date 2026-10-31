# Status

**Current milestone:** M0, Bootstrap (in review)
**Next task:** M1.1, write `spec/profile/profile-1.0.json` and `spec/schema/manifest.schema.json`

## Owner actions (only the project owner can do these)

- [ ] Create GitHub repos `<owner>/flexova` (public) and `<owner>/flexpad` (private), and attach them to the Claude session
- [ ] Trademark search: FLEXOVA and FLEXPAD in USPTO, EUIPO and WIPO Global Brand Database, classes 9 and 42 (ask the attorney to compare against "Flexera")
- [ ] Register a domain (flexova.com/.dev/.org), then replace the `namespaceUri` placeholder in `spec/constants.json`
- [ ] Create the npm org `@flexova` and a PyPI account
- [ ] Before M3: enable npm and PyPI trusted publishing for this repo's release workflow
- [ ] From M4: test on a real iPhone and Android device each milestone
- [ ] Before M6: recruit 3 pilot organizations with field or technical manuals

## Milestones

Size: S ≈ 1 session, M ≈ 2–3, L ≈ 4+. Each milestone ends with a PR.

### M0: Bootstrap (S) · in review

- [x] Import prototypes into `prototypes/`
- [x] pnpm/TypeScript monorepo; `@flexova/core` skeleton with naming constants
- [x] Python `flexova` skeleton (stdlib only)
- [x] `spec/constants.json` as single source of truth, enforced by TS and Python tests
- [x] Licenses (Apache-2.0, CC-BY-4.0 for `spec/`), NOTICE, SECURITY.md, README
- [x] CLAUDE.md, ADR-0001 to ADR-0012
- [x] CI workflow (lint, format, typecheck, test, build, Python)
- [ ] Pushed and CI green on GitHub (blocked on repo creation)

### M1: Spec v0.1, conformance, reference implementations (M)

- [ ] M1.1 `spec/profile/profile-1.0.json` (elements, attributes, allowed children, required attributes, block vs inline, so it can generate an editor schema) and `spec/schema/manifest.schema.json`
- [ ] M1.2 `spec/flexova-1.0.md`: container, profile, manifest, tokens, metadata, conformance classes (Producer, Viewer, Editor), compatibility rules, signature location
- [ ] M1.3 `conformance/` with ≥ 15 valid fixtures, ≥ 25 invalid fixtures with error codes, and hostile fixtures (port `prototypes/flex/make_hostile.py`), plus `expected.json`
- [ ] M1.4 `@flexova/core`: `write()` (deterministic), `read()`, `validate()` (coded errors, limits), `compileTokens()`, OPF and nav generation
- [ ] M1.5 `python/flexova`: `write()` and `validate()` (port `prototypes/flex/flex_min.py`), passing the same suite
- [ ] M1.6 CI `conformance.yml`: epubcheck and Ace by DAISY on valid fixtures; settle whether a `META-INF/` extra file is allowed (ADR-0003)
- Done when TS and Python agree on every fixture, epubcheck reports 0 errors, Ace reports 0 violations, and builds are byte-identical.

### M2: Viewer + single-file HTML (M)

`@flexova/viewer` (port `prototypes/flex/web/flex-viewer.js`, ≤ 6 KB gzipped), `@flexova/html` (static-first), examples, and Playwright on 3 engines × 4 widths × 2 themes, plus isolation, offline and attack suites.

### M3: CLI, importers, signing, first publish (M)

`flexova` CLI (`new`, `build`, `check`, `pack --html`, `inspect`, `export --epub`, `sign`/`verify`), `@flexova/import` (Markdown, Pandoc), Docker image, and 0.1.0 releases to npm and PyPI.

### M4–M6: FlexPad (private repo)

Web reader (M4), editor (M5), pilot release (M6).

### Later

M7 native wrappers · M8 Flexova Seal · M9 server, collaboration, Rust core if needed.

## Open questions

- Does epubcheck accept `META-INF/flexova.json`? If not, use `OEBPS/flexova.json` (settle in M1.6).
- Namespace URI waits on the domain (owner action).
