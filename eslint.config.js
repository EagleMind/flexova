import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**", "prototypes/**", "python/**"],
  },
  js.configs.recommended,
  tseslint.configs.strict,
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: { globals: globals.node },
  },
  {
    // Benchmarks run some functions inside the browser (page.evaluate).
    files: ["bench/**/*.mjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // ADR-0007/0008: core and viewer run in browsers, native WebViews and Node alike.
    files: [
      "packages/core/src/**/*.ts",
      "packages/viewer/src/**/*.ts",
      "packages/import/src/**/*.ts",
    ],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:*"],
              message: "Keep Node APIs out of isomorphic packages (tests may use them).",
            },
          ],
        },
      ],
    },
  },
);
