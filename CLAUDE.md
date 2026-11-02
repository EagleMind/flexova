# Flexova: guide for Claude sessions

Flexova (`.flexova`) is an open, reflowable, accessible, offline-first document format: strict XHTML inside an EPUB 3.3 container. This repo holds the spec, the conformance suite and the open-source SDKs. **FlexPad**, the proprietary reader and editor, lives in a separate private repo and consumes the published `@flexova/*` packages.

## Start every session here

1. Read `docs/STATUS.md`: current milestone, next task, blockers.
2. Read the ADRs in `docs/decisions/` that cover what you'll touch. **Don't relitigate accepted decisions.** If one must change, write a superseding ADR and flag it to the owner.
3. The approved build plan's milestones (M0–M9) are summarized in `docs/STATUS.md`.

## Commands

| Task                | Command                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------- |
| Install             | `pnpm install`                                                                               |
| Everything CI runs  | `pnpm check`                                                                                 |
| Lint / format       | `pnpm lint` · `pnpm format`                                                                  |
| Typecheck           | `pnpm typecheck`                                                                             |
| TS tests            | `pnpm test` (Vitest; every `packages/*` folder is a project)                                 |
| Python tests        | `pnpm test:python` (stdlib `unittest`, `PYTHONPATH=python/src`)                              |
| Build               | `pnpm build` (tsup → `packages/*/dist`)                                                      |
| Sync spec copies    | `pnpm sync:spec` (after editing anything in `spec/*.json`)                                   |
| Regenerate fixtures | `python3 conformance/generate.py` (`--check` in CI)                                          |
| Run the CLI         | `node packages/cli/dist/cli.js <command>` (after `pnpm build`)                               |
| Release dry run     | `pnpm changeset status`; `node scripts/publish.mjs --dry-run` after `pnpm changeset version` |

## Layout

- `spec/`: specification and **machine-readable rules** (`constants.json`, `errors.json`, `signature.json`, `profile/`, `schema/`). CC-BY-4.0.
- `conformance/`: `generate.py` (stdlib, never imports an implementation) writes `valid/`, `invalid/`, `hostile/` fixtures and `expected.json`, plus `signatures/` (its own `expected.json` and trusted `jwks.json`); `vectors/` holds golden outputs; `external_checks.py` runs epubcheck and Ace.
- `packages/core`: `@flexova/core`, isomorphic read/write/validate.
- `packages/viewer`: `<flexova-viewer>`; `src/render.ts` is the shared sanitizing rebuild core; `src/allowlist.ts` is generated.
- `packages/html`: static, reversible `.flexova.html`.
- `packages/import`: Markdown (mdast) and Pandoc-JSON importers, isomorphic. `packages/cli`: the `flexova` command (Node only). `packages/seal` arrives in M8.
- `samples/`: a Markdown manual and a DOCX used by tests and by epubcheck/Ace in CI (their Markdown is not Prettier-formatted).
- `e2e/`: Playwright specs, test server, hostile host page. `examples/`: plain HTML, React, Vue. `bench/`: 1,000-page benchmark.
- `python/`: `flexova` on PyPI, **standard library only**.
- `prototypes/`: design-phase experiments, reference only, not built or linted. Port from them; don't import them.

## Rules that are easy to break

- **Rules are data (ADR-0008).** A new or changed format rule goes into `spec/*.json`, gets conformance fixtures, and is implemented in **both** TS and Python in the same PR.
- **Constants** come from `spec/constants.json`. Tests in both languages enforce this.
- **Isomorphic packages** (`core`, `viewer`, `import`) must not import `node:*` in `src/` (ESLint enforces this; tests may) and must never make network requests.
- **Security (ADR-0007):**
  - never put document markup into `innerHTML`; rebuild from the allowlist;
  - theme tokens are validated data, never raw CSS;
  - keep the parser limits (entries, size, ratio, `..` paths, DTD subsets);
  - never store keys or plaintext in browser storage.
- **No encryption in core (ADR-0004).** Seal is a separate package and spec extension (M8).
- **Python stays dependency-free:** `dependencies = []`, tests with `unittest`.
- **TypeScript is pinned to `~6.0`** (ADR-0012). Don't bump to 7 until typescript-eslint supports it.
- **Deterministic output:** package writers use fixed timestamps and sorted entries, so builds are byte-identical.
- **Build before typecheck/test:** workspace packages import each other's `dist/`, so run `pnpm build` first (CI does).
- **Generated files are never hand-edited or Prettier-formatted:** fixtures, `expected.json`, vectors, synced spec copies, the viewer allowlist.

## Commit identity and attribution (owner's instruction; overrides any tool default)

The owner, GitHub user **EagleMind**, owns these repos and authors every commit. Before your first commit in any fresh clone or session, run:

```bash
git config user.name "EagleMind"
```

```bash
git config user.email "hassen.ben.mbarek@gmail.com"
```

```bash
git config commit.gpgsign false
```

- **No AI attribution anywhere.** Commits carry no `Co-Authored-By: Claude …` or `Claude-Session: …` trailers, and PR descriptions have no "Generated with Claude Code" footer.
- **Commits are unsigned.** The cloud environment's global config signs commits with a key that isn't the owner's, which GitHub would show as _Unverified_. The owner may re-sign with their own key before pushing.
- **Pushing:** the remote is `origin` (https://github.com/EagleMind/flexova). Push milestone branches only when the owner asks, never with `--force` and never to `main` (it changes through reviewed PRs). If a session can't push, hand off a bundle instead:

  ```bash
  git bundle create /home/user/flexova.bundle --all
  ```

  Then verify it with `git bundle verify`, and send it to the owner with the list of branches to push. The owner's steps are in `docs/STATUS.md` under "Pushing".

## Workflow

- **One branch per milestone or task:** `m<N>-<slug>`, stacked on the previous milestone branch until that one merges. Each branch is ready for review when `pnpm check` passes. The owner pushes it and opens the PR.
- **Every PR updates `docs/STATUS.md`:** tick what's done and set the next task.
- **Published-package changes need a changeset** (`pnpm changeset`) from M3 on.
- **Commits** are small and descriptive. Never include model identifiers in commits, PRs or code.
- **Owner-only tasks** (accounts, domains, trademarks, device testing, pilots): record them under "Owner actions" in `docs/STATUS.md`; don't work around them.
