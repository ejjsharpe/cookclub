import type { Env as AppEnv } from "./types";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    AI: AppEnv["AI"];
    BROWSER: AppEnv["BROWSER"];
    RECIPE_CACHE: AppEnv["RECIPE_CACHE"];
    IMAGE_SERVICE: AppEnv["IMAGE_SERVICE"];
    IMAGE_PUBLIC_URL: AppEnv["IMAGE_PUBLIC_URL"];
    ENVIRONMENT: AppEnv["ENVIRONMENT"];
    YOUTUBE_API_KEY: AppEnv["YOUTUBE_API_KEY"];
  }
}
