# Status

**Current milestone:** M1, Spec v0.1 + conformance + reference implementations (in review, branch `m1-spec`)
**Next task:** M2.1, port `prototypes/flex/web/flex-viewer.js` to `packages/viewer` (`<flexova-viewer>`), generating its allowlist from the profile

## Owner actions (only the project owner can do these)

- [ ] Create empty GitHub repos `EagleMind/flexova` (public) and `EagleMind/flexpad` (private), without a README, then push the hand-off bundle (see "Pushing a hand-off bundle" below)
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
- [x] Commit history authored by EagleMind, with no AI attribution (rules in CLAUDE.md)
- [ ] Pushed by the owner, and CI green on GitHub

### M1: Spec v0.1, conformance, reference implementations (M) · in review

- [x] M1.1 `spec/profile/profile-1.0.json`, `spec/errors.json` (59 codes), `spec/schema/manifest.schema.json`
- [x] M1.2 `spec/flexova-1.0.md`, the normative prose (draft 0.1)
- [x] M1.3 `conformance/`: 122 fixtures (24 valid, 71 invalid, 27 hostile), every code exercised; deterministic stdlib generator with `--check`; golden `compileTokens` vectors
- [x] M1.4 `@flexova/core`: `validate()`, `write()` (deterministic), `compileTokens()`; runs in browsers (pure-JS SHA-256 fallback)
- [x] M1.5 `python/flexova`: the same API, standard library only
- [x] M1.6 CI `conformance.yml`: fixture freshness, epubcheck 5.2.1, Ace 1.4.6 (Ace verified locally: 0 violations)
- [ ] epubcheck green in CI (it could not run in the build session; first run happens when the branch is pushed)
- Done when: TS and Python agree on every fixture ✅, Ace reports 0 violations ✅, builds are byte-identical ✅, epubcheck reports 0 errors (pending CI).

### M2: Viewer + single-file HTML (M)

`@flexova/viewer` (port `prototypes/flex/web/flex-viewer.js`, ≤ 6 KB gzipped), `@flexova/html` (static-first), examples, and Playwright on 3 engines × 4 widths × 2 themes, plus isolation, offline and attack suites.

### M3: CLI, importers, signing, first publish (M)

`flexova` CLI (`new`, `build`, `check`, `pack --html`, `inspect`, `export --epub`, `sign`/`verify`), `@flexova/import` (Markdown, Pandoc), Docker image, and 0.1.0 releases to npm and PyPI.

### M4–M6: FlexPad (private repo)

Web reader (M4), editor (M5), pilot release (M6).

### Later

M7 native wrappers · M8 Flexova Seal · M9 server, collaboration, Rust core if needed.

## Pushing a hand-off bundle

Claude sessions don't push. At the end of each work chunk you receive `flexova.bundle` (every branch), with the list of branches to push. From the folder holding the bundle:

```bash
git clone --bare flexova.bundle flexova-handoff.git
```

```bash
cd flexova-handoff.git
```

```bash
git push https://github.com/EagleMind/flexova.git main m0-bootstrap
```

Replace the branch names with the ones listed in the hand-off message. A bare clone keeps every branch, so you can push any of them. The push is never forced: if GitHub already has newer commits on a branch (for example `main` after a merged PR), that branch is skipped with an error and nothing is lost. For day-to-day work, use a normal clone from GitHub.

Then open one PR per milestone branch on GitHub. Branches are stacked (`m1-…` is based on `m0-bootstrap`), so point each PR at the previous milestone branch until that one merges.

If GitHub rejects the push with "push declined due to email privacy restrictions", either turn off _Block command line pushes that expose my email_ (GitHub → Settings → Emails), or send your `@users.noreply.github.com` address so the history can be rewritten to use it.

## Open questions

- Does epubcheck accept `META-INF/flexova.json`? The first CI run of `conformance.yml` answers it. If not, move it to `OEBPS/flexova.json` with a superseding ADR.
- Namespace URI waits on the domain (owner action).
