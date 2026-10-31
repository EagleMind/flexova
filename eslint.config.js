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
    // ADR-0007/0008: core and viewer run in browsers, native WebViews and Node alike.
    files: ["packages/core/src/**/*.ts", "packages/viewer/src/**/*.ts"],
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
