#!/usr/bin/env node
// Copies the normative spec data into each implementation, so published packages are self-contained.
// Tests in both languages fail if a copy drifts from spec/ (run `pnpm sync:spec` to fix).
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  "spec/constants.json": "constants.json",
  "spec/errors.json": "errors.json",
  "spec/profile/profile-1.0.json": "profile-1.0.json",
};
const targets = ["python/src/flexova/_data", "packages/core/src/spec"];

for (const target of targets) {
  mkdirSync(join(root, target), { recursive: true });
  for (const [from, name] of Object.entries(files)) {
    copyFileSync(join(root, from), join(root, target, name));
  }
}
console.log(`synced ${Object.keys(files).length} spec files into ${targets.join(", ")}`);
