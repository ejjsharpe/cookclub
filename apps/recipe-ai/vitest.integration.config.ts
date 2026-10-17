import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

import {
  accordionPotatoes,
  facebookHtml,
  tomatoSoup,
  wheatThins,
} from "./tests/fixtures/facebook";
import { goustoApiUrl, goustoResponse } from "./tests/fixtures/gousto";

const facebookResponses = Object.fromEntries(
  [wheatThins, accordionPotatoes, tomatoSoup].flatMap((fixture) => {
    const canonical = fixture.meta["og:url"];
    return [
      [
        fixture.sourceUrl,
        fixture.sourceUrl !== canonical
          ? { location: canonical }
          : { body: facebookHtml(fixture) },
      ],
      [canonical, { body: facebookHtml(fixture) }],
    ];
  }),
);

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
        // native fetch options as well as parsing without contacting providers.
        outboundService: "recipe-origin",
        workers: [
          {
            name: "recipe-origin",
            modules: true,
            compatibilityDate: "2026-07-24",
            bindings: {
              GOUSTO_API_URL: goustoApiUrl,
              GOUSTO_RESPONSE: goustoResponse,
              FACEBOOK_RESPONSES: facebookResponses,
              FACEBOOK_SUBTITLES: wheatThins.subtitles,
            },
            script: `export default {
            fetch(request, env) {
              const facebook = env.FACEBOOK_RESPONSES[request.url];
              if (facebook) {
                if (facebook.location) return Response.redirect(facebook.location, 302);
                return new Response(facebook.body, { headers: { "content-type": "text/html" } });
              }
              if (request.url === "https://scontent.xx.fbcdn.net/fixtures/wheat-thins/captions.srt") {
                return new Response(env.FACEBOOK_SUBTITLES, { headers: { "content-type": "text/srt" } });
              }
              if (request.url === "https://video.xx.fbcdn.net/fixtures/accordion-potatoes/audio.mp4") {
                return new Response(new Uint8Array([1, 2]), { headers: { "content-type": "audio/mp4" } });
              }
              if (request.url === "https://api.groq.com/openai/v1/audio/transcriptions") {
                return Response.json({ text: "[Instrumental music, no speech]" });
              }
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
