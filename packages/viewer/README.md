# @flexova/viewer

`<flexova-viewer>` displays Flexova (`.flexova`) documents in any web page or framework: plain HTML, React, Vue, Angular, Svelte, or a native app's WebView.

- **Safe with untrusted files:**
  - document markup is rebuilt from an allowlist, never inserted as HTML;
  - no scripts run;
  - nothing is fetched on the document's behalf;
  - zip bombs and oversized files are refused.
- **Isolated in both directions:** Shadow DOM keeps your styles out of the document, and its styles and ids out of your page.
- **Offline:** everything comes from the file.
- **Small:** about 7 KB gzipped, with no dependencies.
- **Readable:** follows the system light or dark theme, reflows to any width, and wide tables scroll in place.

## Use

```html
<script src="flexova-viewer.min.js"></script>
<flexova-viewer src="/docs/manual.flexova"></flexova-viewer>
```

With a bundler:

```js
import "@flexova/viewer";

const viewer = document.querySelector("flexova-viewer");
viewer.load(await (await fetch(url, { headers })).arrayBuffer()); // or a File from <input type="file">
viewer.addEventListener("flexova-load", (e) => console.log(e.detail.title, e.detail.toc));
```

See [`examples/`](../../examples/) for a complete plain-HTML reader and React and Vue components, including the full API.

**Styling hooks:**

- `theme="light"` or `theme="dark"` overrides the system setting.
- The `--flexova-font-scale` custom property (for example `1.25`) scales the document's text, for reading-size controls.
- Printing renders every chapter, each starting on a new page.

## `@flexova/viewer/render`

The environment-free rebuild routine the viewer uses, exported for other renderers (for example `@flexova/html`). It reads any parsed tree through a `Source` and writes through a `Sink`.

## License

Apache-2.0
