// Renders every valid conformance fixture to a static .flexova.html page (requires `pnpm build`).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { toHtml } from "../packages/html/dist/index.js";
import { CONFORMANCE, HTML_DIR, htmlName, validFixtures } from "./fixtures";

export default async function globalSetup(): Promise<void> {
  mkdirSync(HTML_DIR, { recursive: true });
  for (const rel of validFixtures()) {
    const { html } = await toHtml(new Uint8Array(readFileSync(new URL(rel, CONFORMANCE))));
    writeFileSync(new URL(htmlName(rel), HTML_DIR), html);
  }
}
