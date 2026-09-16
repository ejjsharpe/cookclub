import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

import { goustoApiUrl, goustoResponse } from "./tests/fixtures/gousto";

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/index.ts",
      miniflare: {
        compatibilityDate: "2026-07-24",
        compatibilityFlags: ["nodejs_compat"],
        // Add KV namespace for testing (in-memory)
        kvNamespaces: ["RECIPE_CACHE"],
        // Intercept after workerd constructs the request, so tests exercise
        // native fetch options as well as parsing without contacting Gousto.
        outboundService: "recipe-origin",
        workers: [
          {
            name: "recipe-origin",
            modules: true,
            compatibilityDate: "2026-07-24",
            bindings: {
              GOUSTO_API_URL: goustoApiUrl,
              GOUSTO_RESPONSE: goustoResponse,
            },
            script: `export default {
            fetch(request, env) {
              if (request.url === env.GOUSTO_API_URL) {
                return Response.json(env.GOUSTO_RESPONSE);
              }
              if (request.url === "https://production-api.gousto.co.uk/cmsreadbroker/v1/recipe/redirect-recipe") {
                return Response.redirect("https://example.com/unexpected-redirect", 302);
              }
              return new Response("Unexpected outbound request", { status: 502 });
            }
          };`,
          },
        ],
      },
    }),
  ],
  test: {
    name: "integration",
    include: ["tests/integration/**/*.test.ts"],
  },
});
