import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://cookclub.app",
  output: "static",
  integrations: [react(), sitemap()],
});
