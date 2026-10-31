import { defineConfig } from "vitest/config";

// Every folder in packages/ is its own Vitest project (named after its package.json).
export default defineConfig({
  test: {
    projects: ["packages/*"],
  },
});
