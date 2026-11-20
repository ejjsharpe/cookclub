import {
  DEFAULT_RECIPE_SEARCH_FILTERS,
  timeLabel,
  type RecipeSearchFilters,
} from "./recipeSearchFilters";
import type { RecipeSourceFilter } from "../../api/recipe";

export interface SearchTag {
  id: number;
  name: string;
  recipeCount: number;
}

/** A filter shown as a pill inside the search field. */
export interface SearchToken {
  key: string;
  label: string;
  /** The filters with this token taken out. */
  without: (filters: RecipeSearchFilters) => RecipeSearchFilters;
}

/** A chip above the field that adds a filter in one tap. */
export interface SearchChip {
  key: string;
  label: string;
  apply: (filters: RecipeSearchFilters) => RecipeSearchFilters;
}

const SOURCE_TOKEN_LABELS: Record<RecipeSourceFilter, string> = {
  mine: "My own",
  web: "From websites",
  cook: "From cooks",
};

/** The most useful time limit to offer as a chip. */
const QUICK_TIME = 30;

/** Tokens in the order they read in the field: time, source, then tags. */
export function searchTokens(
  filters: RecipeSearchFilters,
  tags: SearchTag[],
): SearchToken[] {
  const tokens: SearchToken[] = [];
  if (filters.maxTotalTime != null) {
    tokens.push({
      key: "time",
      label: timeLabel(filters.maxTotalTime),
      without: (f) => ({ ...f, maxTotalTime: null }),
    });
  }
  if (filters.source) {
    tokens.push({
      key: "source",
      label: SOURCE_TOKEN_LABELS[filters.source],
      without: (f) => ({ ...f, source: null }),
    });
  }
  for (const tagId of filters.tagIds) {
    tokens.push({
      key: `tag:${tagId}`,
      label: tags.find((tag) => tag.id === tagId)?.name ?? "Tag",
      without: (f) => ({ ...f, tagIds: f.tagIds.filter((id) => id !== tagId) }),
    });
  }
  return tokens;
}

/** Backspace in an empty field takes off the last token. */
export function withoutLastToken(
  filters: RecipeSearchFilters,
  tags: SearchTag[],
): RecipeSearchFilters {
  const last = searchTokens(filters, tags).at(-1);
  return last ? last.without(filters) : filters;
}

/**
 * Chips that narrow the search: a time limit, then the tags with the most
 * recipes, skipping anything already applied.
 */
export function searchChips(
  filters: RecipeSearchFilters,
  tags: SearchTag[],
  limit = 6,
): SearchChip[] {
  const chips: SearchChip[] = [];
  if (filters.maxTotalTime == null) {
    chips.push({
      key: "time",
      label: timeLabel(QUICK_TIME),
      apply: (f) => ({ ...f, maxTotalTime: QUICK_TIME }),
    });
  }
  const unused = tags
    .filter((tag) => tag.recipeCount > 0 && !filters.tagIds.includes(tag.id))
    .sort((a, b) => b.recipeCount - a.recipeCount);
  for (const tag of unused) {
    if (chips.length >= limit) break;
    chips.push({
      key: `tag:${tag.id}`,
      label: tag.name,
      apply: addTag(tag.id),
    });
  }
  return chips;
}

export const addTag =
  (tagId: number) =>
  (filters: RecipeSearchFilters): RecipeSearchFilters =>
    filters.tagIds.includes(tagId)
      ? filters
      : { ...filters, tagIds: [...filters.tagIds, tagId] };

/** Tags whose words start with what's typed, so "c" offers "Chinese". */
export function matchingTags(
  query: string,
  tags: SearchTag[],
  applied: number[],
  limit = 3,
): SearchTag[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return tags
    .filter(
      (tag) =>
        !applied.includes(tag.id) &&
        tag.name
          .toLowerCase()
          .split(/\s+/)
          .some((word) => word.startsWith(needle)),
    )
    .slice(0, limit);
}

export function isDefaultSearch(filters: RecipeSearchFilters): boolean {
  return (
    filters.sort === DEFAULT_RECIPE_SEARCH_FILTERS.sort &&
    filters.maxTotalTime == null &&
    filters.source == null &&
    filters.tagIds.length === 0
  );
}
