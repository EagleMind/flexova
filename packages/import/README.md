# @flexova/import

Convert documents into Flexova (`.flexova`) content:

- **Markdown:** CommonMark plus GitHub Flavored Markdown, from one file or many in reading order.
  - Tables, task lists, strikethrough and footnotes are supported.
  - GitHub alerts (`> [!WARNING]`) become callouts.
  - Front matter can set `title`, `lang` and `author`.
- **Everything Pandoc reads:** DOCX, ODT, HTML, LaTeX, reStructuredText and more, via Pandoc's JSON output (`pandoc -t json`).
  - Word paragraph styles named Note, Tip, Important, Warning or Caution become callouts. Read the DOCX with `-f docx+styles`.
  - Images with Word captions become figures.

What you get back is valid by construction:

- every chapter splits at a level-1 heading;
- headings, figures and tables get ASCII ids, and links between files and chapters are rewritten to match;
- local images are embedded;
- footnotes become endnotes, with links in both directions.

Anything Flexova can't represent is simplified and reported in `warnings`, so nothing is dropped silently. That covers raw HTML, remote images, links to outside files, and TeX math.

```js
import { fromMarkdown, fromPandoc } from "@flexova/import";
import { write } from "@flexova/core";

const result = fromMarkdown([{ path: "manual.md", text }], {
  language: "en",
  readFile: (path) => images[path], // Uint8Array, or undefined if missing
});
console.warn(result.warnings);
const bytes = await write({
  ...result,
  identifier: "urn:uuid:…",
  modified: "2026-11-02T00:00:00Z",
});
```

The package runs in browsers and Node. Running Pandoc itself is left to the caller; the `flexova` CLI does it for you.

## License

Apache-2.0
