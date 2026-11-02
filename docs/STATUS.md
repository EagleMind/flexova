# Status

**Current milestone:** M4, FlexPad web reader (in review: `m4-reader` in `EagleMind/flexpad`, and the hooks it needed on `m4-reader-hooks` here)
**Next task:** M5.1, the FlexPad editor (in the flexpad repo). Here: the first 0.1.0 release once the owner's npm/PyPI setup is done.

## Owner actions (only the project owner can do these)

- [x] Create the public GitHub repo `EagleMind/flexova` and give the Claude GitHub App access to it (done 2026-11-02; all milestone branches pushed)
- [x] Create the repo `EagleMind/flexpad` (public, AGPL-3.0 per ADR-0016) and give the Claude GitHub App access to it
- [ ] Open one PR per milestone branch, each targeting the previous one (`m0-bootstrap` → `main`, `m1-spec` → `m0-bootstrap`, `m2-viewer` → `m1-spec`, `m3-cli` → `m2-viewer`, `m4-reader-hooks` → `m3-cli`), or ask a Claude session to open them
- [ ] Trademark search: FLEXOVA and FLEXPAD in USPTO, EUIPO and WIPO Global Brand Database, classes 9 and 42 (ask the attorney to compare against "Flexera")
- [ ] Register a domain (flexova.com/.dev/.org), then replace the `namespaceUri` placeholder in `spec/constants.json`
- [ ] Create the npm org `@flexova` and a PyPI account
- [ ] Before the first release (when M3 is merged into `main`):
  - npm: npm can only add a trusted publisher to a package that already exists. So after `npm login`, publish a `0.0.0` placeholder of each package from a clone of `main`: `pnpm install && pnpm build`, then in each `packages/<name>` folder run `pnpm pack` and `npm publish flexova-<name>-0.0.0.tgz --access public --tag placeholder`. Then, on npmjs.com, add the trusted publisher (repository `EagleMind/flexova`, workflow `release.yml`) to each of the five packages. The release workflow publishes 0.1.0 from then on.
  - PyPI: add a pending trusted publisher for the project `flexova`: repository `EagleMind/flexova`, workflow `release.yml`, environment `pypi`. Create that environment in the repo's settings.
  - GHCR: after the first image push, set the `flexova-cli` package's visibility to public.
- [ ] Try `flexova build` on a real Word document from your field (the DOCX sample was made with Pandoc), and report anything that converts poorly
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
- [x] Pushed to GitHub
- [ ] Reviewed and merged

### M1: Spec v0.1, conformance, reference implementations (M) · in review

- [x] M1.1 `spec/profile/profile-1.0.json`, `spec/errors.json` (59 codes), `spec/schema/manifest.schema.json`
- [x] M1.2 `spec/flexova-1.0.md`, the normative prose (draft 0.1)
- [x] M1.3 `conformance/`: 122 fixtures (24 valid, 71 invalid, 27 hostile), every code exercised; deterministic stdlib generator with `--check`; golden `compileTokens` vectors
- [x] M1.4 `@flexova/core`: `validate()`, `write()` (deterministic), `compileTokens()`; runs in browsers (pure-JS SHA-256 fallback)
- [x] M1.5 `python/flexova`: the same API, standard library only
- [x] M1.6 CI `conformance.yml`: fixture freshness, epubcheck 5.2.1, Ace 1.4.6 (Ace verified locally: 0 violations)
- [x] epubcheck green in CI (epubcheck 5.2.1 accepts `META-INF/flexova.json`)
- Done when: TS and Python agree on every fixture ✅, Ace reports 0 violations ✅, builds are byte-identical ✅, epubcheck reports 0 errors ✅.

### M2: Viewer + single-file HTML (M) · in review

- [x] M2.1 `@flexova/viewer`: `<flexova-viewer>` (7.2 KB gzipped, budget 8 KB per ADR-0014); allowlist generated from the profile; shared `./render` core
- [x] M2.2 `@flexova/html`: static `.flexova.html` (no scripts, CSP with no network); reversible via `fromHtml()`
- [x] M2.3 Playwright suite: 285 tests on Chromium (layout matrix, isolation, offline, every hostile fixture, JS-off static pages, axe WCAG 2.2 AA 0 violations, example)
- [x] M2.4 `examples/` (plain HTML, React, Vue); `bench/` (1,000 pages); `e2e.yml` for Chromium, Firefox, WebKit
- [x] Chromium, Firefox and WebKit green in CI, along with epubcheck and Ace. WebKit needed two fixes: inflating without `Blob.stream()`, and allowing `blob:` URLs in the request check.
- [ ] Real-device check on an iPhone and an Android phone (owner, from M4; earlier is welcome)

### M3: CLI, importers, signing, first publish (M) · in review

- [x] M3.1 Signatures (spec section 11 is normative):
  - `spec/signature.json`: compact detached JWS over the manifest, alg `Ed25519`, six verification codes;
  - 24 signature fixtures;
  - `sign`/`verify` in `@flexova/core` (WebCrypto) and Python (pure RFC 8032), which produce byte-identical signature files.
- [x] M3.2 `@flexova/import`: Markdown (CommonMark + GFM via mdast) and Pandoc JSON (DOCX, ODT, HTML, LaTeX…). Covers callouts from alerts and Word styles, endnotes, figures with captions, and cross-file links. Warnings, never silent loss.
- [x] M3.3 `@flexova/cli` (`flexova`): `new`, `build`, `check`, `inspect`, `pack` (`--html` or a folder), `unpack`, `export --epub`, `keygen`, `sign`, `verify`. Builds are reproducible.
- [x] M3.4 Release setup:
  - Changesets, with `scripts/publish.mjs` (`pnpm pack` then `npm publish` via OIDC, with provenance);
  - `release.yml` covers npm, PyPI and the GHCR Docker image;
  - CI builds the Docker image and converts a DOCX with it;
  - the sample Markdown manual and DOCX go through epubcheck and Ace in CI;
  - ADR-0015.
- [ ] First release: `@flexova/*` 0.1.0 and `flexova` 0.1.0 (Python). This needs the owner's npm and PyPI setup above, then the merge to `main`.
- Done when:
  - sample Markdown and DOCX convert to valid files ✅ (epubcheck and Ace clean in CI; the Docker image converts the DOCX in CI);
  - signatures verify and fail on tampering ✅;
  - `npx @flexova/cli check` works from a clean machine: a clean install of the packed tarballs works ✅, and the registry install waits on the first release.

### M4–M6: FlexPad (public repo, AGPL-3.0)

M4 (the web reader) is built and in review in the `EagleMind/flexpad` repo, which tracks its own status. Hooks it needed from this repo are on branch `m4-reader-hooks`: `read()` metadata, the viewer's `--flexova-font-scale`, and print rendering.

Web reader (M4), editor (M5), pilot release (M6).

### Later

M7 native wrappers · M8 Flexova Seal · M9 server, collaboration, Rust core if needed.

## Pushing

The repo lives at https://github.com/EagleMind/flexova. Claude sessions that have the repo attached push milestone branches to `origin` when the owner asks. CI runs on every branch push; pull requests from forks also run it.

### Pushing a hand-off bundle (fallback)

When a session can't push, it hands off `flexova.bundle` (every branch) with the list of branches to push. From the folder holding the bundle:

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

- Namespace URI waits on the domain (owner action).
- TeX math from Pandoc sources stays TeX (shown as code) until a TeX→MathML step is added. Decide whether M5's editor needs it.
