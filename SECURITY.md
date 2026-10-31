# Security policy

Flexova readers open files from untrusted sources, so security bugs matter here more than in most libraries.

## Reporting a vulnerability

Please **do not open a public issue.** Report privately through GitHub's _Report a vulnerability_ button (Security → Advisories) on this repository. Include a sample `.flexova` file if you can. We aim to acknowledge reports within 5 working days.

## In scope

- Script execution, style injection or network access triggered by document content in `<flexova-viewer>` or any official reader.
- Parser weaknesses: zip bombs, path traversal, XML entity expansion, oversized entries, malformed central directories.
- Validator bypasses, where a hostile package passes `validate()`.
- Once it ships (milestone M8), Flexova Seal: key handling, header downgrade or denial-of-service, entry splicing.

## Out of scope

- An authorized reader copying, printing or screenshotting a document. No document format can prevent this (see `docs/decisions/ADR-0004-no-encryption-in-core.md`).
- Look-alike HTML files that impersonate Flexova. Any HTML file can do this; see ADR-0006.
