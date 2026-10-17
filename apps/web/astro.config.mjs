import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://cookclub.app",
  output: "static",
  vite: { resolve: { dedupe: ["react", "react-dom"] } },
  integrations: [
    react(),
    sitemap({
      filter: (page) => !new URL(page).pathname.startsWith("/reset-password"),
    }),
  ],
});
