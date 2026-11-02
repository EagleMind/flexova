# @flexova/html

Turn a Flexova (`.flexova`) package into **one static `.flexova.html` file** that opens in any browser:

- **No JavaScript needed:** the page works with scripts disabled, in mail and file previewers, and offline.
- **Locked down:** a Content-Security-Policy forbids scripts and every network request; images and audio are inline `data:` URIs.
- **Reflowable and accessible:** semantic HTML with in-page links, dark mode via the system setting, wide tables that scroll in place.
- **Reversible:** the page carries the original package, so `fromHtml()` recovers every entry byte for byte, and its hashes and signature can be verified.

```js
import { toHtml, fromHtml } from "@flexova/html";

const { html, warnings } = await toHtml(packageBytes); // throws FlexovaError for invalid packages
const original = fromHtml(html); // Uint8Array of a re-packed .flexova
```

Pages above 30 MB produce a warning (`softLimitBytes` to change it). For very large documents, share the `.flexova` package or a link instead.

## License

Apache-2.0
