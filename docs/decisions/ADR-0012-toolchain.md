# ADR-0012: Toolchain

- **Status:** Accepted, 2026-10-31.

## Decision

| Concern                | Choice                                                                                                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime                | Node 22 LTS (≥ 22.18, required by tsup 9 and Changesets 3)                                                                                                                 |
| Package manager        | pnpm 10 workspaces (`packageManager` pinned; dependency install scripts allowlisted in `pnpm-workspace.yaml`)                                                              |
| Language               | TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), ESM only                                                             |
| **TypeScript version** | **Pinned to `~6.0.x`.** TypeScript 7 (the native Go compiler) is current, but typescript-eslint 8.72 supports only `<6.1.0`. Move to 7 once typescript-eslint supports it. |
| Build                  | tsup (ESM + `.d.ts`)                                                                                                                                                       |
| Tests                  | Vitest 5 (each `packages/*` folder is a project); Playwright for browser end-to-end tests (from M2); Python `unittest` (stdlib)                                            |
| Lint and format        | ESLint 10 flat config with typescript-eslint strict; Prettier                                                                                                              |
| Releases               | Changesets; npm and PyPI **trusted publishing** through GitHub OIDC (no stored tokens) from M3                                                                             |
| CI                     | GitHub Actions: `pnpm check` plus Python tests; conformance (epubcheck + Ace) from M1; Playwright on Chromium, Firefox and WebKit from M2                                  |

## Consequences

- **Running CI locally:** `pnpm check` runs exactly what CI runs.
- **Python stays dependency-free** (`dependencies = []`); its tests use only `unittest`.
