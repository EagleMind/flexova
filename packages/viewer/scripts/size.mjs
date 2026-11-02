#!/usr/bin/env node
// Size budget for the standalone viewer bundle (ADR-0014): fails the build above 8 KB gzipped.
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const BUDGET = 8 * 1024;
const file = new URL("../dist/flexova-viewer.min.js", import.meta.url);
const raw = readFileSync(file);
const gz = gzipSync(raw, { level: 9 }).length;
console.log(`flexova-viewer.min.js: ${raw.length} B raw, ${gz} B gzipped (budget ${BUDGET} B)`);
if (gz > BUDGET) {
  console.error("viewer bundle is over its size budget");
  process.exit(1);
}
