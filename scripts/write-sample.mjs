#!/usr/bin/env node
// Writes a representative package with the TypeScript writer (after `pnpm build`), for external validators.
// Usage: node scripts/write-sample.mjs <out.flexova>
import { writeFileSync } from "node:fs";
import { write } from "../packages/core/dist/index.js";

const svg = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" role="img"><rect width="10" height="10"/></svg>',
);
const pkg = await write({
  identifier: "urn:uuid:7d1c9f40-1b7a-4c51-9a2e-00000000beef",
  title: "Field Service Manual",
  language: "en",
  modified: "2026-11-02T00:00:00Z",
  authors: ["EagleMind"],
  tokens: { color: { accent: { light: "#0b5fff", dark: "#7aa7ff" } }, measure: 70 },
  chapters: [
    {
      title: "Before you start",
      body:
        '<section id="s1" epub:type="chapter" role="doc-chapter"><h1 id="h1">Before you start</h1>' +
        '<p>Isolate the unit. See <a href="02.xhtml#specs">specifications</a>.</p>' +
        '<aside role="note" data-flexova-variant="warning"><p>Capacitors hold charge.</p></aside></section>',
    },
    {
      title: "Specifications",
      body:
        '<section id="specs"><h1 id="h2">Specifications</h1>' +
        '<figure id="f1"><img src="../assets/chart.svg" alt="Bar chart" width="10" height="10"/><figcaption>Torque curve</figcaption></figure>' +
        '<table id="t1"><caption>Torque</caption><thead><tr><th scope="col">Bolt</th><th scope="col">Nm</th></tr></thead>' +
        "<tbody><tr><td>A1</td><td>25</td></tr></tbody></table>" +
        '<p><math xmlns="http://www.w3.org/1998/Math/MathML" alttext="x equals 2"><mi>x</mi><mo>=</mo><mn>2</mn></math></p></section>',
    },
  ],
  assets: [{ path: "assets/chart.svg", mediaType: "image/svg+xml", data: svg }],
});
writeFileSync(process.argv[2], pkg);
console.log(`wrote ${process.argv[2]} (${pkg.length} bytes)`);
