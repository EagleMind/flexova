import { defineConfig } from "tsup";

export default defineConfig([
  {
    // ESM for bundlers and frameworks; ./render is the environment-free core shared with @flexova/html.
    entry: { index: "src/index.ts", render: "src/render.ts" },
    format: ["esm"],
    dts: true,
    clean: true,
    target: "es2022",
  },
  {
    // A single <script src> for pages without a bundler. Size-budgeted (scripts/size.mjs).
    entry: { "flexova-viewer.min": "src/index.ts" },
    format: ["iife"],
    minify: true,
    target: "es2022",
    outExtension: () => ({ js: ".js" }),
  },
]);
