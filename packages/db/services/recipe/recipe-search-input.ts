import { isRecognizedUnit, MIN_RECIPE_SEARCH_LENGTH } from "@repo/shared";

import { ServiceError } from "../errors";
import { normalizeRecipeListLimit } from "./recipe-list.service";

export const MAX_RECIPE_SEARCH_LENGTH = 100;
export const MAX_RECIPE_SEARCH_LEXEMES = 10;

const QUANTITY_TOKEN = /^(?:\d+(?:[./]\d+)?|[¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])$/u;

export interface RecipeSearchInput {
  query: string;
  tagIds?: number[];
  maxTotalTime?: number;
  limit?: number;
}

export interface NormalizedRecipeSearchInput {
  query: string;
  ingredientQuery: string;
  tagIds: number[];
  maxTotalTime: number | null;
  limit: number;
}

export function normalizeRecipeSearchQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ");
}

export function normalizeRecipeTitleForSearch(value: string): string {
  return value
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Remove only a leading ingredient quantity and recognized measurement unit. */
export function normalizeIngredientSearchQuery(query: string): string {
  const tokens = normalizeRecipeSearchQuery(query).split(" ");
  let start = 0;

  if (QUANTITY_TOKEN.test(tokens[start] ?? "")) {
    start++;
    if (/^\d+\/\d+$/.test(tokens[start] ?? "")) start++;
  }

  const unitToken = (tokens[start] ?? "").replace(/[.,]$/g, "");
  if (isRecognizedUnit(unitToken)) start++;

  return tokens.slice(start).join(" ").trim();
}

export function normalizeRecipeSearchInput(
  input: RecipeSearchInput,
): NormalizedRecipeSearchInput {
  const query = normalizeRecipeSearchQuery(input.query);
  if (
    query.length < MIN_RECIPE_SEARCH_LENGTH ||
    query.length > MAX_RECIPE_SEARCH_LENGTH
  ) {
    throw new ServiceError(
      "BAD_REQUEST",
      `Recipe searches must be ${MIN_RECIPE_SEARCH_LENGTH}-${MAX_RECIPE_SEARCH_LENGTH} characters.`,
    );
  }

  const tagIds = [
    ...new Set(
      (input.tagIds ?? []).map(Math.trunc).filter((tagId) => tagId > 0),
    ),
  ].sort((a, b) => a - b);
  const maxTotalTime =
    input.maxTotalTime === undefined || !Number.isFinite(input.maxTotalTime)
      ? null
      : Math.max(0, Math.trunc(input.maxTotalTime));

  return {
    query,
    ingredientQuery: normalizeIngredientSearchQuery(query),
    tagIds,
    maxTotalTime,
    limit: normalizeRecipeListLimit(input.limit),
  };
}
