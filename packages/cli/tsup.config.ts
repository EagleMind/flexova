import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts", "src/main.ts"],
  format: ["esm"],
  target: "node22",
  dts: { entry: "src/main.ts" },
  clean: true,
});
