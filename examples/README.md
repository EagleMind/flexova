# Examples

| Example                                | What it shows                                                                                                                                            |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`plain-html/`](plain-html/index.html) | A complete offline reader in one HTML file: file picker, drag and drop, table of contents, theme switch. No build step. Covered by the end-to-end tests. |
| [`react/`](react/FlexovaDocument.jsx)  | A React component wrapping `<flexova-viewer>`, with events and a table of contents.                                                                      |
| [`vue/`](vue/FlexovaDocument.vue)      | The same as a Vue 3 single-file component.                                                                                                               |

To try the plain HTML example locally, first build the packages:

```bash
pnpm build
```

Then serve the repository root with any static file server and open `/examples/plain-html/`.

## The viewer API in brief

|                       |                                                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `viewer.load(source)` | Display a document from an `ArrayBuffer`, `Uint8Array` or `Blob`/`File`. Never throws; failures arrive as `flexova-error`.    |
| `src` attribute       | Convenience: fetch a URL and display it. Use `load()` when requests need authentication.                                      |
| `theme` attribute     | `light` or `dark`; omit it to follow the system setting.                                                                      |
| `flexova-load` event  | `detail`: `{ title, language, toc: [{ label, href, depth }], chapters }`.                                                     |
| `flexova-error` event | `detail`: `{ code, message }`. `code` is one of `NOT_A_PACKAGE`, `TOO_LARGE`, `SEALED`, `UNSUPPORTED_VERSION`, `LOAD_FAILED`. |
| `viewer.goTo(href)`   | Scroll to an entry from `toc` or any in-document anchor.                                                                      |
| `viewer.info`         | The last `flexova-load` detail, or `null`.                                                                                    |

The viewer never makes network requests on a document's behalf, never runs document code, and isolates the document from your page's styles in both directions.
