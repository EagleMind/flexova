# Flexova: guide for Claude sessions

Flexova (`.flexova`) is an open, reflowable, accessible, offline-first document format: strict XHTML inside an EPUB 3.3 container. This repo holds the spec, the conformance suite and the open-source SDKs. **FlexPad**, the proprietary reader and editor, lives in a separate private repo and consumes the published `@flexova/*` packages.

## Start every session here

1. Read `docs/STATUS.md`: current milestone, next task, blockers.
2. Read the ADRs in `docs/decisions/` that cover what you'll touch. **Don't relitigate accepted decisions.** If one must change, write a superseding ADR and flag it to the owner.
3. The approved build plan's milestones (M0–M9) are summarized in `docs/STATUS.md`.

## Commands

| Task               | Command                                                         |
| ------------------ | --------------------------------------------------------------- |
| Install            | `pnpm install`                                                  |
| Everything CI runs | `pnpm check`                                                    |
| Lint / format      | `pnpm lint` · `pnpm format`                                     |
| Typecheck          | `pnpm typecheck`                                                |
| TS tests           | `pnpm test` (Vitest; every `packages/*` folder is a project)    |
| Python tests       | `pnpm test:python` (stdlib `unittest`, `PYTHONPATH=python/src`) |
| Build              | `pnpm build` (tsup → `packages/*/dist`)                         |

## Layout

- `spec/`: specification and **machine-readable rules** (`constants.json`; `profile/` and `schema/` from M1). CC-BY-4.0.
- `conformance/` (M1+): shared fixtures plus `expected.json` with verdicts and error codes.
- `packages/core`: `@flexova/core`, isomorphic read/write/validate.
- `packages/{viewer,html,import,cli}` (M2–M3) and `packages/seal` (M8).
- `python/`: `flexova` on PyPI, **standard library only**.
- `prototypes/`: design-phase experiments, reference only, not built or linted. Port from them; don't import them.

## Rules that are easy to break

- **Rules are data (ADR-0008).** A new or changed format rule goes into `spec/*.json`, gets conformance fixtures, and is implemented in **both** TS and Python in the same PR.
- **Constants** come from `spec/constants.json`. Tests in both languages enforce this.
- **Isomorphic packages** (`core`, `viewer`) must not import `node:*` in `src/` (ESLint enforces this; tests may) and must never make network requests.
- **Security (ADR-0007):**
  - never put document markup into `innerHTML`; rebuild from the allowlist;
  - theme tokens are validated data, never raw CSS;
  - keep the parser limits (entries, size, ratio, `..` paths, DTD subsets);
  - never store keys or plaintext in browser storage.
- **No encryption in core (ADR-0004).** Seal is a separate package and spec extension (M8).
- **Python stays dependency-free:** `dependencies = []`, tests with `unittest`.
- **TypeScript is pinned to `~6.0`** (ADR-0012). Don't bump to 7 until typescript-eslint supports it.
- **Deterministic output:** package writers use fixed timestamps and sorted entries, so builds are byte-identical.

## Workflow

- **One branch per milestone or task:** `m<N>-<slug>`. Open a PR to `main`, and get CI green before asking for review.
- **Every PR updates `docs/STATUS.md`:** tick what's done and set the next task.
- **Published-package changes need a changeset** (`pnpm changeset`) from M3 on.
- **Commits** are small and descriptive. Never include model identifiers in commits, PRs or code.
- **Owner-only tasks** (accounts, domains, trademarks, device testing, pilots): record them under "Owner actions" in `docs/STATUS.md`; don't work around them.
