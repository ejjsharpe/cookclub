import type { RecipeImportErrorCode } from "@repo/contracts/recipe-import";

export type PersistedImportErrorCode = RecipeImportErrorCode;

export function exhaustedImportErrorCode(
  errorCode: RecipeImportErrorCode,
): RecipeImportErrorCode {
  return errorCode === "IMPORT_TIMED_OUT"
    ? "IMPORT_TIMED_OUT"
    : "SERVICE_UNAVAILABLE";
}
