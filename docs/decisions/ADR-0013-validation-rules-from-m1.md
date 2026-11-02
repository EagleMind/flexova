# ADR-0013: Validation rules decided while building M1

- **Status:** Accepted, 2026-11-02.

## Context

Writing two independent validators (TypeScript and standard-library Python) against one conformance suite exposed places where "the obvious behavior" differs between runtimes, or where the profile couldn't express what accessibility tools expect. Each needed an explicit rule.

## Decisions

| #   | Decision                                                                                                                                                                 | Why                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **The validation result is the sorted set of codes**, with explicit phases and fatal codes (`spec/errors.json`). Messages, paths and repeat counts are informative only. | Lets independent implementations be compared exactly, without forcing identical message text.                                                                                                                        |
| 2   | **Bytes after the end of a deflate stream inside an entry are ignored.** A truncated stream is `ZIP_CORRUPT`.                                                            | fflate, browser `DecompressionStream` and Node all ignore trailing bytes. Rejecting them would make browsers and Python disagree. Size and CRC still protect the output.                                             |
| 3   | **Manifest JSON nesting is limited to 32 levels** (`maxManifestDepth`).                                                                                                  | Python's parser raises `RecursionError` around depth 20,000, while V8 parses 5,000,000. Without a limit the same file would get different verdicts. Real manifests reach depth 4.                                    |
| 4   | **No DOCTYPE except `<!DOCTYPE html>`, and the text `<!ENTITY` is forbidden** in every XML file.                                                                         | Expat (Python) and saxes (JS) treat undefined entities differently when an external DTD is declared. Banning DTDs removes the divergence and every entity-expansion attack.                                          |
| 5   | **Entry names are ASCII `[A-Za-z0-9._-/]`.**                                                                                                                             | No percent-decoding or Unicode normalization anywhere, so references resolve identically in every language. Writers generate the names anyway.                                                                       |
| 6   | **DPUB-ARIA `role` is allowed on `section` and `nav`**, and writers emit `role="doc-toc"`.                                                                               | Ace by DAISY reports `epub-type-has-matching-role` when `epub:type` has no matching role. Without this, no package using `epub:type` could pass Ace.                                                                 |
| 7   | **SHA-256 falls back to a pure-JS implementation** when WebCrypto is unavailable.                                                                                        | `crypto.subtle` exists only in secure contexts. Apps embedding Flexova on plain-http intranet pages or in some WebViews would otherwise crash in `validate()`. The fallback is tested against NIST vectors and Node. |
| 8   | **Undeclared archive files are errors** (`OPF_UNDECLARED_RESOURCE`), and so are unlisted ones (`MAN_ENTRIES_INCOMPLETE`).                                                | No hidden payloads that manifest-based tools never see.                                                                                                                                                              |

## Evidence

- Both implementations pass all 122 fixtures, and each validates the other's writer output.
- `@flexova/core` passes 120 of 120 fixtures in Chromium on a non-secure page, exercising the SHA-256 fallback; the two multi-megabyte bombs run only in Node.
- 20 valid fixtures plus both writers' output pass Ace 1.4.6 with zero violations.
- epubcheck could not run in the build session (downloaded executables are blocked there). CI runs it on every PR (`conformance.yml`), which also settles ADR-0003's open question about `META-INF/flexova.json`.
