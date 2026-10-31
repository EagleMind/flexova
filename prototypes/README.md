# Prototypes

Throwaway experiments from the design phase that **proved** the Flexova architecture before any production code was written. They predate the final name, so they say `flex` / `fdoc` instead of `flexova`.

**These are reference material, not part of the build.** CI does not lint or test them. Production code lives in `packages/` and `python/`, and each milestone ports the relevant prototype there (see `docs/STATUS.md`).

## `flex/`: format, viewer, offline, attacks

| File | What it is | Proved |
|---|---|---|
| `flex_min.py` | A Flexova (EPUB 3.3-shaped) writer using only the Python standard library (56 non-blank lines) | Any stack can produce the format with no dependencies. Output is deterministic (two builds are byte-identical), `mimetype` sits at the standard offset, and all XML is well-formed. |
| `web/flex-viewer.js` | A `<flex-viewer>` web component: minimal ZIP reader (central directory + `DecompressionStream`), XML-bomb guard, rebuild-from-allowlist sanitizer, design tokens compiled to CSS | **4.0 KB gzipped** with zero dependencies. Shadow DOM isolates styles and IDs in both directions. No network access. |
| `web/index.html`, `web/sw.js` | A hostile host page (red 40px text, `img{display:none!important}`) plus a service worker that caches the app shell | Host CSS doesn't leak in. The app reloads offline with the server killed. |
| `make_hostile.py` | Generates attack packages: XSS (script, `onerror`, `javascript:`, inline style/onclick, iframe, SVG script), XML entity bomb, `../` path traversal, a 200 MB zip bomb, CSS injection via tokens, a sealed file | Every attack is either neutralized or refused with a clear error. |
| `test-viewer.cjs` | Playwright test that runs all of the above | |

Run (Chromium via Playwright):

```bash
python3 flex/flex_min.py flex/out/manual.flex
```

```bash
node flex/test-viewer.cjs
```

## `poc/`: encryption and scale (now the optional Seal extension, milestone M8)

| File | What it is | Proved |
|---|---|---|
| `fdoc-crypto.mjs`, `build.mjs`, `browser-test.cjs` | v1 custom envelope: PBKDF2 → AES-KW → AES-256-GCM per entry, and a self-unlocking HTML file | WebCrypto works on `file://`. A wrong passphrase, a moved entry and a flipped bit are all rejected. |
| `fdoc-jwe.mjs` | v2 standards-based envelope: a tiny RFC 7516 JWE subset (`A256GCM`, `PBES2-HS512+A256KW`, `ECDH-ES+A256KW`) plus per-entry AES-GCM with the path as AAD | |
| `jwe-interop.mjs`, `jwe-interop.py` | Interop matrix against `jose` (Node) and `jwcrypto` (Python) | 20/20 checks pass in both directions. Library defaults are a trap: jose's multi-recipient encrypt hard-codes p2c=2048, and the decrypt caps are 10k (jose) and 16,384 (jwcrypto). Hostile headers are refused (DoS or downgraded p2c, `alg=dir`, `zip`, off-curve key). |
| `gen-scale.mjs`, `runtime.js`, `base.css`, `scale-test.cjs` | 1,000 pages plus 20 MB of photos, emitted as static HTML and as a sealed file | Plain 30 MB file: loads in 0.36 s (2.0 s at 4× CPU throttle), no overflow at 320 px, readable with JS off. Sealed: first chapter 0.46 s after unlock, whole document 2.9 s at 4×. |

`poc/` needs `npm install` (for `jose`) and Python `jwcrypto`. The generated outputs (30 MB HTML files, keys) are not committed. Regenerate them with `node poc/gen-scale.mjs`.

## `naming/`

`name_check.py` checks candidate names and extensions against GitHub Linguist, mime-db, freedesktop shared-mime-info and `/etc/mime.types`, and against the npm, PyPI, crates.io, RubyGems and NuGet registries. It is how **Flexova** / `.flexova` was chosen (see `docs/decisions/ADR-0001-naming.md`).
