import type { RecipeImportStrategy } from "@repo/contracts/recipe-import";

import type { ParsedRecipe } from "../../schema";
import type { Env, ParseMetadata } from "../../types";

const CACHE_TTL_SECONDS = 86_400;
const CACHE_SCHEMA_VERSION = 2;

export interface RecipeCacheEntry {
  schemaVersion: typeof CACHE_SCHEMA_VERSION;
  parseMethod: NonNullable<ParseMetadata["parseMethod"]>;
  strategy: RecipeImportStrategy;
  provenance: RecipeImportStrategy;
  createdAt: string;
  recipe: ParsedRecipe;
}

export interface CachedRecipe {
  entry: RecipeCacheEntry;
  strategy: RecipeImportStrategy;
}

function canonicalCacheUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  return url.toString();
}

export async function recipeCacheKey(
  url: string,
  strategy: RecipeImportStrategy,
): Promise<string> {
  const data = new TextEncoder().encode(canonicalCacheUrl(url));
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `recipe:v2:${strategy}:${hashHex}`;
}

function isRecipeCacheEntry(value: unknown): value is RecipeCacheEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<RecipeCacheEntry>;
  return (
    entry.schemaVersion === CACHE_SCHEMA_VERSION &&
    (entry.strategy === "deterministic" || entry.strategy === "ai-assisted") &&
    entry.provenance === entry.strategy &&
    typeof entry.parseMethod === "string" &&
    typeof entry.createdAt === "string" &&
    Boolean(entry.recipe && typeof entry.recipe === "object")
  );
}

async function getEntry(
  kv: Env["RECIPE_CACHE"],
  url: string,
  strategy: RecipeImportStrategy,
): Promise<CachedRecipe | null> {
  const cached = await kv.get(await recipeCacheKey(url, strategy), "json");
  return isRecipeCacheEntry(cached) ? { entry: cached, strategy } : null;
}

export async function getCachedRecipe(
  kv: Env["RECIPE_CACHE"],
  url: string,
  strategy: RecipeImportStrategy,
): Promise<CachedRecipe | null> {
  if (strategy === "deterministic") {
    return await getEntry(kv, url, "deterministic");
  }

  return (
    (await getEntry(kv, url, "ai-assisted")) ??
    (await getEntry(kv, url, "deterministic"))
  );
}

export async function cacheRecipe(
  kv: Env["RECIPE_CACHE"],
  url: string,
  recipe: ParsedRecipe,
  options: {
    parseMethod: NonNullable<ParseMetadata["parseMethod"]>;
    strategy: RecipeImportStrategy;
  },
): Promise<void> {
  const entry: RecipeCacheEntry = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    parseMethod: options.parseMethod,
    strategy: options.strategy,
    provenance: options.strategy,
    createdAt: new Date().toISOString(),
    recipe,
  };
  await kv.put(
    await recipeCacheKey(url, options.strategy),
    JSON.stringify(entry),
    { expirationTtl: CACHE_TTL_SECONDS },
  );
}

export async function deleteCachedRecipe(
  kv: Env["RECIPE_CACHE"],
  url: string,
  strategy: RecipeImportStrategy,
): Promise<void> {
  const deleteFn = (kv as { delete?: (key: string) => Promise<void> }).delete;
  if (typeof deleteFn !== "function") return;
  await deleteFn.call(kv, await recipeCacheKey(url, strategy));
}
