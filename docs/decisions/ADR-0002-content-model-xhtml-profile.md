# ADR-0002: Content model is a strict XHTML profile

- **Status:** Accepted, 2026-10-31. Supersedes the "custom JSON AST" idea from blueprint v1.

## Context

Content must be:

- reflowable and accessible;
- safe to render from untrusted files;
- easy to produce from any language;
- readable without JavaScript;
- durable for decades.

A custom JSON tree is easy to validate, but it needs our renderer everywhere, can't be read without it, and feels proprietary. Markdown comes in many flavors, has no stable IDs, and can't express figures, callouts or table spans cleanly.

## Decision

Content documents are **strict XHTML (XML syntax), restricted to an allowlisted profile.** The profile is defined as data in `spec/profile/profile-1.0.json` (milestone M1).

- **Allowed:** semantic structure (`section`, `h1`–`h6`, `p`, lists, `blockquote`, `aside role="note"` with a variant, `details`/`summary`); media (`figure`, `picture`/`img`, `audio`); tables with `caption` and `th scope`; `pre`/`code`; MathML; links (`https`, `mailto` and in-document fragments only); and `abbr`, `dfn`, `sup`, `sub`, `lang` and `dir`.
- **Forbidden:** `style` attributes, scripts, iframes, objects, forms, event handlers, remote resource URLs, and DTD internal subsets or entity declarations.
- **Required:** IDs on headings, figures and tables; `alt` on every image.
- **Tooling:** tools may hold content in memory as hast (HTML as JSON), but the stored form is XHTML.

## Consequences

- **Readable without code:** browsers and EPUB readers render it natively; an unencrypted document can be read with JavaScript off.
- **Validatable everywhere:** XML syntax means every language's _standard library_ XML parser can parse and validate it. No HTML5 parser is needed.
- **Safe display needs a rebuild:** viewers must rebuild content from the allowlist rather than insert it directly (ADR-0007).
- **Authors get structure, not layout:** fixed layout and pixel positioning are non-goals.

## Evidence

- `prototypes/flex/flex_min.py` produces conforming content with stdlib only.
- `prototypes/poc/gen-scale.mjs` and `scale-test.cjs` showed that 1,000 pages render static-first, with no horizontal overflow at 320 px.
