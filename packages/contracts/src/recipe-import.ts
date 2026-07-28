import type { PublicErrorCode } from "./errors";

export type RecipeImportType = "basic" | "smart";
export type RecipeImportMode = "url" | "text" | "image";
export type RecipeImportStatus =
  | "pending"
  | "processing"
  | "ready"
  | "failed"
  | "consumed";
export type RecipeImportStrategy = "deterministic" | "ai-assisted";

export type RecipeImportErrorCode = Extract<
  PublicErrorCode,
  | "IMPORT_ACTIVE_LIMIT_REACHED"
  | "IMPORT_INVALID_URL"
  | "IMPORT_UNSUPPORTED_SOURCE"
  | "IMPORT_SOURCE_UNAVAILABLE"
  | "IMPORT_RECIPE_NOT_FOUND"
  | "IMPORT_IMAGE_INVALID"
  | "PAYLOAD_TOO_LARGE"
  | "IMPORT_TIMED_OUT"
  | "IMPORT_FAILED"
  | "SERVICE_UNAVAILABLE"
>;

export type ParseFailure = {
  code: RecipeImportErrorCode;
  disposition: "terminal" | "retry";
  retryAfterSeconds?: number;
};

export const RECIPE_IMPORT_LIMITS = {
  urlCharacters: 4_096,
  textCharacters: 10_000,
  sourceImageBytes: 10 * 1024 * 1024,
  placeholderTitleCharacters: 200,
  activeJobsPerUser: 5,
  pendingTimeoutMs: 10 * 60 * 1_000,
  processingLeaseMs: 5 * 60 * 1_000,
  processingTimeoutMs: 6 * 60 * 1_000,
  terminalRetentionMs: 30 * 24 * 60 * 60 * 1_000,
  pendingIntentRetentionMs: 24 * 60 * 60 * 1_000,
} as const;

export const RECIPE_IMPORT_SOURCE_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type RecipeImportSourceImageType =
  (typeof RECIPE_IMPORT_SOURCE_IMAGE_TYPES)[number];

export const BASIC_IMPORT_UNSUPPORTED_HOSTS = [
  "instagram.com",
  "tiktok.com",
  "facebook.com",
  "fb.com",
  "youtube.com",
  "youtu.be",
] as const;

export type RecipeImportSource =
  | { type: "url"; value: string }
  | { type: "text"; value: string }
  | { type: "image"; uploadKey: string };

export type CreateRecipeImportRequest =
  | {
      id: string;
      importType: "basic";
      source: Extract<RecipeImportSource, { type: "url" }>;
    }
  | {
      id: string;
      importType: "smart";
      source: RecipeImportSource;
    };

export function recipeImportStrategyForType(
  importType: RecipeImportType,
): RecipeImportStrategy {
  return importType === "basic" ? "deterministic" : "ai-assisted";
}

export function isRecipeImportSourceImageType(
  value: string | null | undefined,
): value is RecipeImportSourceImageType {
  return RECIPE_IMPORT_SOURCE_IMAGE_TYPES.some((type) => type === value);
}

export function isBasicImportUnsupportedHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return BASIC_IMPORT_UNSUPPORTED_HOSTS.some(
    (host) => normalized === host || normalized.endsWith(`.${host}`),
  );
}

export function isBasicImportUnsupportedUrl(value: string): boolean {
  try {
    return isBasicImportUnsupportedHost(new URL(value).hostname);
  } catch {
    return false;
  }
}

export function normalizeRecipeImportUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Recipe import URLs must use HTTP or HTTPS.");
  }
  url.hash = "";
  return url.toString();
}

export function recipeImportPlaceholderTitle(
  source: RecipeImportSource,
): string {
  const title =
    source.type === "url"
      ? (() => {
          try {
            return new URL(source.value).hostname.replace(/^www\./, "");
          } catch {
            return "Recipe URL";
          }
        })()
      : source.type === "text"
        ? "Pasted recipe text"
        : "Recipe image";

  return title.slice(0, RECIPE_IMPORT_LIMITS.placeholderTitleCharacters);
}
