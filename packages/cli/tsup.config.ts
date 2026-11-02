import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8"));

export default defineConfig({
  entry: ["src/cli.ts", "src/main.ts"],
  format: ["esm"],
  target: "node22",
  dts: { entry: "src/main.ts" },
  clean: true,
  define: { __FLEXOVA_VERSION__: JSON.stringify(version) },
});
