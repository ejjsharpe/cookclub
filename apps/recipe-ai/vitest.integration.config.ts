import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/index.ts",
      miniflare: {
        compatibilityDate: "2025-02-20",
        compatibilityFlags: ["nodejs_compat"],
        // Add KV namespace for testing (in-memory)
        kvNamespaces: ["RECIPE_CACHE"],
      },
    }),
  ],
  test: {
    name: "integration",
    include: ["tests/integration/**/*.test.ts"],
  },
});
