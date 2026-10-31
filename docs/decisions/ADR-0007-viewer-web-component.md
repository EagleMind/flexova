# ADR-0007: The viewer is a dependency-free web component

- **Status:** Accepted, 2026-10-31.

## Decision

`@flexova/viewer` defines `<flexova-viewer>`:

- **Framework-agnostic:** plain HTML, React, Vue, Angular, Svelte and native WebViews.
- **Shadow DOM:** with `:host { all: initial }`, host CSS can't leak in and document IDs can't leak out.
- **No network requests:** the host app fetches the bytes (authentication is the host's job) and calls `load(ArrayBuffer | Blob)`, or sets `src`.
- **Rebuild, never insert:** content is parsed with `DOMParser` (XHTML) and rebuilt node by node from the profile allowlist with `createElement`/`textContent`. Document markup never reaches `innerHTML`. Unknown elements are unwrapped (their text is kept); unknown attributes are dropped.
- **Theme tokens are data:** the viewer validates them (for example, colors must be hex) and compiles them to CSS itself. Documents can never inject raw CSS.
- **Parser limits:** maximum entries, total uncompressed size, and compression ratio; decompression is bounded by each entry's declared size; `/` and `..` paths and DTD subsets are rejected.
- **Its own ~60-line ZIP reader** (central directory + `DecompressionStream`) instead of a ZIP library, to stay tiny.
- **Size budget:** ≤ 6 KB gzipped, enforced in CI.

## Evidence (`prototypes/flex/web/flex-viewer.js`, `test-viewer.cjs`)

- **Size:** 4.0 KB gzipped.
- **Isolation:** hostile host CSS (including `!important`) did not leak in.
- **Offline:** works from a service-worker cache with the server killed.
- **Attacks:** with XSS payloads (script, `onerror`, `javascript:` links, inline style and onclick, iframe, SVG script), nothing executed. CSS injection through tokens was blocked. An XML entity bomb, a path-traversal file and a 200 MB zip bomb were all refused.
