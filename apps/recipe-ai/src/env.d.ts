import type { Env as AppEnv } from "./types";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    BROWSER: AppEnv["BROWSER"];
    RECIPE_CACHE: AppEnv["RECIPE_CACHE"];
    IMAGE_SERVICE: AppEnv["IMAGE_SERVICE"];
    IMAGE_PUBLIC_URL: AppEnv["IMAGE_PUBLIC_URL"];
    CEREBRAS_API_KEY: AppEnv["CEREBRAS_API_KEY"];
    GROQ_API_KEY: AppEnv["GROQ_API_KEY"];
    REPLICATE_API_TOKEN: AppEnv["REPLICATE_API_TOKEN"];
    YOUTUBE_API_KEY: AppEnv["YOUTUBE_API_KEY"];
  }
}
