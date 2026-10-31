# ADR-0003: Container is EPUB 3.3 OCF

- **Status:** Accepted, 2026-10-31. Supersedes blueprint v1's custom "OCF-inspired" ZIP.

## Context

The biggest project risk is adoption ("yet another format"). EPUB 3.3 is a W3C Recommendation:

- Apple Books, Thorium and Kobo already read it.
- Archives already accept it.
- epubcheck and Ace by DAISY can validate it.

Blueprint v1 rejected EPUB because EPUB _reading apps_ restyle content and offer only DRM-based encryption. Both objections concern the reading app, not the container.

## Decision

- A `.flexova` file is an **EPUB 3.3 OCF ZIP**:
  - `mimetype` is the first entry, stored uncompressed, containing `application/epub+zip`;
  - `META-INF/container.xml` points to an OPF package document;
  - there is a generated nav document.
- Flexova-specific data lives in `META-INF/flexova.json`: profile version, protection level, tokens and entry hashes.
- The OPF declares the profile with a `flexova:` prefixed property, not `dcterms:conformsTo`, which accessibility checkers reserve for conformance claims.
- **Unencrypted (L0) files must pass epubcheck**, and CI enforces this from M1.
- Our own viewer controls rendering; EPUB apps are a free fallback.
- Sealed files keep a valid outer EPUB whose only readable page is a "this document is protected" placeholder.

## Consequences

- **Rename to `.epub` and it opens** in the e-reader ecosystem; free validation tooling.
- **The compiler must generate OPF and nav correctly** and produce deterministic ZIPs.
- **Open question for M1:** does epubcheck accept an extra file in `META-INF/`? If not, move the manifest to `OEBPS/flexova.json`, declared in the OPF manifest. Running epubcheck in this design session was blocked, so CI settles it.
- **Images:** AVIF is not an EPUB core media type. WebP (a core type) is the default, with AVIF only behind a `<picture>` fallback.
