# ADR-0006: Static-first single-file HTML, and the distribution order

- **Status:** Accepted, 2026-10-31.

## Context

- **The browser is the only universally installed renderer**, so a self-contained `.html` file opens anywhere.
- **Some environments don't run JavaScript:** iOS Quick Look, mail previewers and some file managers.
- **An HTML attachment carrying an encrypted blob plus decoding JS** looks like HTML smuggling (MITRE ATT&CK T1027.006), which gateways quarantine.

## Decision

- **Unencrypted `.flexova.html` is static.** It contains the content XHTML inline, assets as `data:` URIs, CSS custom properties driven by `prefers-color-scheme`, and **no JavaScript required**. Optional JS only adds TOC, search and settings.
- **Locked-down HTML:** a CSP meta tag pins scripts and styles by hash and allows no network access.
- **Soft size cap of 30 MB**, with a warning, until real-device memory limits are measured. Larger documents use the package plus HTTP Range requests.
- **The HTML wrapper is a deterministic, reversible transform of the package**, so a trusted reader can extract the original and verify it.
- **Distribution order:** a link to a reader, then `.flexova` (contains no code), then `.flexova.html`.

## Evidence

`prototypes/poc/gen-scale.mjs` and `scale-test.cjs` (Chromium 153):

- 1,000 pages plus 20 MB of photos make a 30 MB file;
- it loads in 0.36 s (2.0 s at 4× CPU throttle), with first paint at 0.07–0.26 s;
- 0 px horizontal overflow at 320 and 375 px;
- readable with JS off, and dark mode works from CSS alone.

## Consequences

- **Real-device testing:** the 30 MB cap and phone memory need a device lab (M4).
- **Dark-mode charts:** use `<picture>` dark variants, or SVGs with an internal `prefers-color-scheme` media query. Photos are dimmed, never inverted.
- **Never store sensitive data in browser storage:** on `file://` it is shared by every local HTML file (measured in Chromium).
