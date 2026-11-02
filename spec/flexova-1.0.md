# Flexova 1.0

**Status:** Draft 0.1 (editor's draft, 2026-11-02). Licensed under [CC-BY-4.0](LICENSE).

Flexova is a document format for reports, manuals and other documents that people read on any screen. A Flexova package is reflowable, accessible by construction, self-contained (it works offline), and safe to open from untrusted sources. An unencrypted Flexova package is also a valid EPUB 3.3 publication.

This specification is deliberately small. Every rule an implementation must enforce is also published as data:

| File                                                         | Defines                                                                                              |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| [`constants.json`](constants.json)                           | Names: extension, media types, manifest path, profile version, namespace                             |
| [`profile/profile-1.0.json`](profile/profile-1.0.json)       | The content profile: elements, content models, attributes, value types, forbidden constructs, limits |
| [`errors.json`](errors.json)                                 | Every validation code, with its phase, severity and fatality                                         |
| [`schema/manifest.schema.json`](schema/manifest.schema.json) | The structure of `META-INF/flexova.json`                                                             |

Where prose and data disagree, the data files are normative, and the disagreement is a bug in this document. The [conformance suite](../conformance/) defines the expected result for 122 packages.

## 1. Conformance

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as described in BCP 14 ([RFC 2119], [RFC 8174]) when, and only when, they appear in capitals.

This specification defines four conformance classes:

| Class         | Requirement                                                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Producer**  | MUST only emit packages that a Validator reports as valid (no error-severity codes).                                                |
| **Validator** | MUST report exactly the set of codes listed in `conformance/expected.json` for every fixture, following the algorithm in section 8. |
| **Viewer**    | MUST meet the rendering requirements of section 9 for every package it displays, including invalid ones.                            |
| **Editor**    | MUST be a Producer, and MUST preserve content it does not understand (section 10) when it re-saves a package.                       |

The reference implementations are `@flexova/core` (TypeScript) and `flexova` (Python, standard library only). Both pass the full conformance suite.

## 2. Terminology

- **Package:** a `.flexova` file, a ZIP archive structured as described here.
- **Entry:** a file inside the package, named by its path from the archive root.
- **Package document:** the EPUB package document (OPF) that `META-INF/container.xml` points to.
- **Manifest:** `META-INF/flexova.json`, the Flexova manifest (not the OPF `<manifest>`, called the _item list_ here).
- **Content document:** an XHTML item with media type `application/xhtml+xml`.
- **Profile:** the content profile in `profile/profile-1.0.json`.
- **XML whitespace:** the characters U+0020, U+0009, U+000D and U+000A, and nothing else.

## 3. The package (ZIP container)

A package is a ZIP archive that satisfies the EPUB 3.3 Open Container Format, with these additional restrictions.

### 3.1 Entries

1. **Encoding of names:** entry names MUST be ASCII and MUST match the profile's `entryNamePattern` (`[A-Za-z0-9._-]` segments separated by `/`). Directory entries (names ending in `/`) are allowed and ignored.
2. **Safe paths:** names MUST NOT be absolute, contain `\`, or contain an empty, `.` or `..` segment (`ZIP_UNSAFE_PATH`).
3. **Uniqueness:** no two names may be equal when compared case-insensitively (`ZIP_DUPLICATE_ENTRY`).
4. **Compression:** only methods 0 (stored) and 8 (deflate). ZIP64 and multi-disk archives are not supported (`ZIP_UNSUPPORTED_FEATURE`). ZIP-level encryption MUST NOT be used (`ZIP_ENCRYPTED_ENTRY`); confidential documents use the separate _Flexova Seal_ extension instead.
5. **The `mimetype` entry:** the entry with the lowest local-header offset MUST be named `mimetype`, MUST be stored uncompressed, MUST have no extra field in its local header, and MUST contain exactly the ASCII bytes `application/epub+zip`.

### 3.2 Limits

The profile's `limits` apply to the sizes and counts _declared_ in the central directory, before anything is decompressed:

- `maxEntries` (10,000): more entries is `ZIP_TOO_MANY_ENTRIES`.
- `maxEntryBytes` (256 MiB) per entry and `maxTotalBytes` (512 MiB) in total: exceeding either is `ZIP_SIZE_LIMIT`.
- `maxCompressionRatio` (200:1), for entries of at least `compressionRatioMinBytes` (1 MiB): a higher ratio is `ZIP_RATIO_LIMIT`.

While decompressing, an implementation MUST NOT produce more output than the declared uncompressed size. More output, less output, a truncated deflate stream or a CRC-32 mismatch is `ZIP_CORRUPT`. Bytes that follow the end of a complete deflate stream within an entry's compressed data are ignored. Data descriptors are allowed; sizes and CRCs are taken from the central directory.

### 3.3 Reading algorithm

1. Locate the end-of-central-directory record by scanning backwards from 22 bytes before the end of the file, over at most 65,535 bytes of comment.
2. Reject a ZIP64 end-of-central-directory locator (20 bytes before that record), multi-disk fields, or saturated (`0xFFFF`/`0xFFFFFFFF`) fields.
3. Check the entry-count limit, then read every central-directory header and apply section 3.1 and 3.2 to each.
4. If any error was found, stop.
5. Decompress every file entry, located by its local header. The compressed data MUST end before the central directory.
6. Apply the `mimetype` rules of section 3.1.

Every ZIP-phase code is fatal.

## 4. The package document

### 4.1 Container

`META-INF/container.xml` MUST exist (`OCF_CONTAINER_MISSING`). Its first `rootfile` element (in the OCF container namespace) MUST have `media-type="application/oebps-package+xml"` and a `full-path` naming an existing entry (`OCF_ROOTFILE_MISSING`). XML errors in this file or in the package document are fatal.

### 4.2 Package element

The package document's root MUST be `<package version="3.0">` in the OPF namespace (`OPF_INVALID`, fatal).

### 4.3 Metadata

- **Required metadata:** non-empty `dc:identifier` (whose `id` is the package's `unique-identifier`), `dc:title`, `dc:language`, and `<meta property="dcterms:modified">` (`OPF_MISSING_METADATA`).
- **Value formats:** the first language MUST be a valid language tag (profile type `lang`), and the modification date MUST have the form `CCYY-MM-DDThh:mm:ssZ` (`OPF_INVALID_METADATA`).
- **Profile declaration:** the `prefix` attribute MUST map `flexova:` to the namespace URI in `constants.json`, and `<meta property="flexova:profile">` MUST be present (`OPF_PROFILE_MISSING`). Its value MUST be `1.` followed by digits (`OPF_PROFILE_UNSUPPORTED`).
- **Accessibility metadata:** producers SHOULD declare the EPUB Accessibility 1.1 properties `schema:accessMode`, `schema:accessModeSufficient`, `schema:accessibilityFeature`, `schema:accessibilityHazard` and `schema:accessibilitySummary`. A missing one is the warning `OPF_A11Y_METADATA_MISSING`.

### 4.4 Item list

1. **Required attributes:** every `item` MUST have `id`, `media-type`, and an `href` that resolves (section 5.4) to a path inside the package. Ids and resolved paths MUST be unique. Any violation is `OPF_INVALID` (fatal).
2. **Media types:** every item's media type MUST be one of the profile's `mediaTypes` (`OPF_UNSUPPORTED_MEDIA_TYPE`). Unsupported items are not checked further.
3. **Existence:** every item MUST exist in the archive (`OPF_MISSING_RESOURCE`).
4. **No undeclared files:** every archive entry except `mimetype`, entries under `META-INF/`, and the package document itself MUST be an item (`OPF_UNDECLARED_RESOURCE`). Hidden payloads are not allowed.
5. **Navigation:** the first item whose `properties` include `nav` MUST be XHTML (`OPF_NAV_MISSING`). Content documents that contain MathML SHOULD carry `properties="mathml"`, as EPUB requires.
6. **Spine:** the spine MUST contain at least one `itemref`, and every `idref` MUST name an XHTML item (`OPF_SPINE_INVALID`).

Checks run in the order of sections 4.1 to 4.4.

## 5. Content documents

### 5.1 XML rules

These apply to every XML entry: content documents, `container.xml`, the package document, and SVG images.

1. **Encoding:** the entry MUST be UTF-8. A byte order mark is allowed. An XML declaration that names another encoding is `XML_ENCODING`.
2. **No DTDs:** the text `<!ENTITY` MUST NOT appear. The only allowed document type declaration is `<!DOCTYPE html>`, and only in content documents. Anything else is `XML_DTD_FORBIDDEN`. This rules out entity-expansion attacks without a DTD processor.
3. **Well-formedness:** the entry MUST be well-formed, namespace-well-formed XML 1.0 (`XML_MALFORMED`).
4. **Root element:** a content document's root MUST be `html` in the XHTML namespace, and an SVG image's root MUST be `svg` in the SVG namespace (`XML_WRONG_NAMESPACE`).

Comments and processing instructions are ignored. CDATA sections are text.

### 5.2 Elements

The profile lists every allowed element.

- **Categories:** each element has a category:
  - `block` (sections, headings, paragraphs, lists, tables…);
  - `inline` (phrasing, `img`, `math`, `picture`);
  - `structural` (parts that belong only inside a specific parent, such as `li`, `tr` and `head` children);
  - `root`.
- **Forbidden elements:** an element named in `forbiddenElements` (in any namespace) is `PRF_FORBIDDEN_ELEMENT`. Examples include `script`, `iframe`, `form`, inline `svg` and `base`.
- **Unknown elements:** any other element outside the profile is `PRF_UNKNOWN_ELEMENT`.

In both cases the element's subtree is not checked further, and the element is ignored when its parent's content model is checked. MathML is allowed inside `math` (MathML namespace) using the elements and attributes in the profile's `mathml` section.

### 5.3 Content models

Each element's `content.type` is one of:

| Model              | Children allowed                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `empty`            | nothing (XML whitespace is tolerated)                                                                                     |
| `text`             | text only                                                                                                                 |
| `inline`           | text and `inline` elements                                                                                                |
| `blocks`           | `block` elements only; other text is an error                                                                             |
| `blocks-or-inline` | either the `inline` model or the `blocks` model, but not a mixture of the two                                             |
| `children`         | only the listed elements, each within `[min, max]`; optionally at least one from `requireOneOf`                           |
| `sequence`         | elements in the listed order, matched greedily: each item takes as many consecutive matching children as its `max` allows |

Violations are `PRF_CONTENT_MODEL`. So is an element that appears inside an ancestor that `excludes` it, such as a link inside a link, and so is XHTML inside MathML.

Nesting deeper than `maxNestingDepth` (64, counting `html` as 1) is `PRF_TOO_DEEP`, reported once per document; deeper content is not checked.

### 5.4 Attributes

- **Attribute names:** attributes are named canonically:
  - no namespace: the local name;
  - XML namespace: `xml:`;
  - EPUB namespace: `epub:`;
  - XLink: `xlink:`;
  - otherwise `{namespace}local`.

  Namespace declarations are not attributes.

- **Forbidden attributes:** a name matching a `forbiddenAttributePatterns` entry (case-insensitive) is `PRF_FORBIDDEN_ATTRIBUTE`. This covers event handlers, `style`, `srcdoc`, `formaction` and XLink. Styling comes only from design tokens (section 7).
- **Allowed attributes:** any other attribute MUST be in the element's `attributes` or in `globalAttributes` (`PRF_ATTRIBUTE_NOT_ALLOWED`).
- **Values:** values MUST satisfy their type, either an enumeration or an `attributeTypes` entry (`PRF_INVALID_VALUE`). Boolean attributes take the empty string or their own name.
- **Required attributes:** a missing `required` attribute is `PRF_MISSING_ATTRIBUTE`, unless the element's `missingCodes` names another code, as with `PRF_MISSING_ALT` for `img`. Headings, figures and tables require an `id`; every image requires `alt` (empty for decorative images).
- **Document language:** `html` requires `lang`. If `xml:lang` is also present, the two MUST be equal ignoring ASCII case.
- **Unique ids:** ids MUST be unique within a document (`PRF_DUPLICATE_ID`).

**Resource references** (`local-uri`: `img src`, `source srcset`, `audio src`, `link href`):

1. A value with a scheme, or one starting with `//`, is `PRF_REMOTE_RESOURCE` for `http`, `https` and protocol-relative values, and `PRF_INVALID_VALUE` for any other scheme, `data:` included. Every resource MUST be embedded.
2. The value MUST NOT be empty, start with `/`, or contain `?`, `#`, `%`, `\` or XML whitespace. It is resolved against the document's directory, and MUST NOT climb above the package root. The resolved path MUST match `entryNamePattern`. Otherwise it is `PRF_INVALID_VALUE`.
3. The resolved path MUST be an item (`PRF_BROKEN_REFERENCE`) of the kind listed in the element's `targets`, such as an `image` for `img` (`PRF_INVALID_VALUE`).

**Links** (`link-uri`: `a href`):

1. **Schemes:** a value with a scheme MUST use `https`, `http` or `mailto` (`PRF_INVALID_VALUE`).
2. **Malformed values:** otherwise, a value starting with `//` or containing `?`, `%`, `\` or XML whitespace is `PRF_INVALID_VALUE`.
3. **Same-document fragments:** `#fragment` MUST name an id in the same document.
4. **Paths:** a path, with an optional fragment, MUST resolve (as above) to an XHTML item. A fragment, if present, MUST be an id in that document; links into a document that is not well-formed are not checked. An empty fragment is never valid.
5. **Broken targets:** a missing target document or fragment is `PRF_BROKEN_LINK`.

### 5.5 Document-level checks

These are warnings:

- **`PRF_HEADING_SKIP`**, once per document, when a heading is more than one level deeper than the previous heading.
- **`PRF_TABLE_NO_HEADERS`**, for a table without any `th`.

The navigation document MUST contain a `nav` whose `epub:type` includes `toc` (`OPF_NAV_INVALID`). Producers SHOULD pair `epub:type` with the matching DPUB-ARIA `role`, such as `doc-toc` and `doc-chapter`, which the profile allows on `nav` and `section`.

## 6. Other resources

- **Stylesheets** (`text/css`) MUST be UTF-8, and MUST NOT contain `@import`, a `url()` whose argument has a scheme or starts with `//`, `expression(`, `behavior:`, `-moz-binding` or `javascript:`, all matched case-insensitively (`CSS_UNSAFE`). Viewers do not use package stylesheets (section 9). They exist for EPUB reading systems.
- **SVG images** MUST follow section 5.1. They MUST NOT contain the elements `script`, `foreignObject`, `iframe`, `handler` or `listener`, attributes starting with `on`, an `href` (in any namespace) that does not start with `#`, or unsafe CSS in `style` (`ASSET_SVG_UNSAFE`).
- **Raster images** MUST start with their format's signature: PNG, JPEG (`FF D8 FF`), GIF87a/89a, or WebP (`RIFF`….`WEBP`) (`ASSET_TYPE_MISMATCH`).
- **Audio** (`audio/mp4`, `audio/mpeg`) is not inspected.

## 7. The Flexova manifest (`META-INF/flexova.json`)

The manifest MUST exist (`MAN_MISSING`). It MUST be UTF-8 JSON without a byte order mark, MUST NOT contain `NaN` or `Infinity`, MUST NOT nest containers more than `maxManifestDepth` (32) levels deep, and MUST be an object (`MAN_INVALID`). Its structure is given by `schema/manifest.schema.json`:

1. **`flexova`** is a `MAJOR.MINOR` string (`MAN_INVALID`). A major version other than 1 is `MAN_UNSUPPORTED_VERSION` (fatal).
2. **`level`** is `L0`, `L1` or `L2` (`MAN_INVALID`). Core Flexova supports only **L0**: L1 (Sealed) and L2 (Controlled) need extensions (`MAN_UNSUPPORTED_LEVEL`, fatal).
3. **`tokens`** (optional) are design tokens. Viewers compile them to CSS themselves; documents never supply raw CSS.
   - **`color`:** an object of names matching `[a-z][a-z0-9-]{0,31}`, each exactly `{light, dark}` with `#rgb` or `#rrggbb` values.
   - **`font`:** `body`, `heading` and `mono`, each one of `system`, `serif`, `sans` or `mono`.
   - **`measure`:** an integer from 40 to 100 (characters).

   Invalid tokens are `MAN_INVALID_TOKEN`. If `bg` is defined, each of `fg`, `accent` and `muted` that is defined MUST reach a WCAG 2 contrast ratio of 4.5:1 against it in both themes (`MAN_LOW_CONTRAST`). Unknown token groups are ignored.

4. **`entries`** lists every archive entry except `mimetype`, the manifest itself and `META-INF/flexova.sig.jws`, each exactly once, as `{path, size, sha256}` with a lowercase hex digest. Malformed or duplicate entries are `MAN_INVALID`.
   - A listed entry that is missing, or whose size or SHA-256 differs, is `MAN_HASH_MISMATCH`.
   - An unlisted archive entry is `MAN_ENTRIES_INCOMPLETE`.

   The entry list is what a detached signature covers (section 11).

Readers MUST ignore unknown top-level members.

### 7.1 Compiling tokens

`compileTokens` turns tokens into the package stylesheet:

1. **Colors:** start with the default palette (fg, bg, accent, muted, surface, note-bg, warning-bg). Valid token colors override defaults of the same name, lowercased. Extra names follow in code-point order.
2. **Light and dark:** emit light values on `:root`, and dark values under `@media (prefers-color-scheme:dark)`.
3. **Fonts and measure:** map fonts to fixed generic stacks. The measure defaults to 68.
4. **Invalid tokens** are ignored.

The exact output is fixed by `conformance/vectors/compile-tokens.json`, and implementations MUST reproduce it byte for byte.

## 8. Validation

Validation runs four phases in order. Each code belongs to one phase (`errors.json`).

1. **zip**: section 3. All codes are fatal.
2. **package**: section 4. Missing or malformed `container.xml` or package document, or `OPF_INVALID`, stop validation.
3. **manifest**: section 7. `MAN_UNSUPPORTED_VERSION` and `MAN_UNSUPPORTED_LEVEL` stop validation.
4. **resources**: sections 5 and 6, visiting supported, existing items in code-point order of path, then resolving cross-document links and the navigation check.

A **fatal** code stops validation after the phase that reported it. A package is **valid** if no error-severity code was reported; warnings never invalidate.

A validator's result for conformance purposes is the sorted, de-duplicated set of codes. Messages, paths and the number of times a code is reported are informative only. Validators MUST NOT throw on malformed input; every problem is a reported code.

## 9. Viewer requirements

A Viewer displays packages that may be hostile. It:

1. MUST NOT execute scripts from a package, and MUST NOT make network requests on a package's behalf. Links open only when the user activates them.
2. MUST NOT insert package markup into a live document as markup (for example through `innerHTML`). It MUST rebuild content element by element from the profile allowlist, dropping forbidden and unknown elements and their subtrees, and dropping disallowed attributes.
3. MUST NOT apply package stylesheets or raw CSS from a package. It MUST compile styling from validated tokens (section 7.1) or use its own defaults.
4. MUST enforce the limits of section 3.2 while reading, and MUST reject DTDs as in section 5.1.
5. SHOULD isolate the document from the host page (for example with Shadow DOM), so that neither side's styles or ids affect the other.
6. SHOULD display invalid packages on a best-effort basis under these same rules, rather than refusing outright, except when a fatal ZIP or package error makes the content unreadable. It MUST refuse packages whose level it does not support, and SHOULD explain why.

## 10. Extensibility and versioning

- **Minor versions** (`1.x`) may add elements, attributes, token groups and manifest members. A 1.0 Validator reports new elements as `PRF_UNKNOWN_ELEMENT`. A Viewer unwraps unknown elements (keeping their text) and ignores unknown attributes, manifest members and token groups.
- **Major versions** change the rules incompatibly and are refused (`MAN_UNSUPPORTED_VERSION`, `OPF_PROFILE_UNSUPPORTED`).
- **Editors** MUST NOT silently drop content they cannot represent. They MUST either preserve it unchanged or ask the user before removing it.

## 11. Signatures (reserved)

A package MAY contain `META-INF/flexova.sig.jws`: a detached JWS (RFC 7515) using EdDSA (Ed25519) over the exact bytes of `META-INF/flexova.json`. Publisher keys are published as a JWKS at `https://<publisher-domain>/.well-known/flexova/jwks.json`. Version 1.0 validators ignore this file. Verification rules will be specified with the reference tooling.

## 12. Security considerations

- **No ZIP-level code execution path:**
  - the ZIP reader rejects path traversal, oversized and over-compressed entries, and size lies before allocating memory;
  - XML parsing rejects all DTDs, so entity expansion is impossible;
  - SVG and CSS are scanned for active content and remote references.
- **No phoning home:** remote resources are forbidden, so opening a package never reveals the reader's IP address or the fact of opening.
- **Undeclared files are errors**, so a package cannot smuggle payloads past manifest-based tooling.
- **Every viewer is an attack surface.** Section 9 is mandatory even for packages that validate.
- **Integrity:** the manifest's SHA-256 list detects accidental corruption. Detecting tampering requires a signature (section 11).
- **Confidentiality** is out of scope for core Flexova. See the Flexova Seal extension.

## 13. Accessibility considerations

- **Structure is semantic by construction:** headings, landmarks via DPUB-ARIA roles, real tables with header cells, lists, and figures with captions. There is no layout-only markup.
- **Text alternatives:** every image needs `alt`. MathML is native and readable by screen readers.
- **Contrast is checked:** text colors are verified against the background in both light and dark themes.
- **Metadata:** EPUB Accessibility 1.1 metadata is expected and checked.
- **Continuous checking:** the conformance suite's valid fixtures pass Ace by DAISY in continuous integration.

## References

- [RFC 2119]: Key words for use in RFCs to Indicate Requirement Levels.
- [RFC 8174]: Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words.
- EPUB 3.3, W3C Recommendation; EPUB Accessibility 1.1.
- RFC 7515: JSON Web Signature; RFC 8037: EdDSA in JOSE.
- WCAG 2.2: contrast ratio and relative luminance.

[RFC 2119]: https://www.rfc-editor.org/rfc/rfc2119
[RFC 8174]: https://www.rfc-editor.org/rfc/rfc8174
