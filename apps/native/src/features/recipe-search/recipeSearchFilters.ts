import type { RecipeSort, RecipeSourceFilter } from "@/api/recipe";

/** Everything the Filters sheet controls. */
export interface RecipeSearchFilters {
  sort: RecipeSort;
  maxTotalTime: number | null;
  source: RecipeSourceFilter | null;
  tagIds: number[];
}

export const DEFAULT_RECIPE_SEARCH_FILTERS: RecipeSearchFilters = {
  sort: "default",
  maxTotalTime: null,
  source: null,
  tagIds: [],
};

export const TIME_OPTIONS = [
  { minutes: 15, label: "15 min" },
  { minutes: 30, label: "30 min" },
  { minutes: 60, label: "1 hour" },
  { minutes: 120, label: "2 hours" },
] as const;

export const SOURCE_OPTIONS: { value: RecipeSourceFilter; label: string }[] = [
  { value: "mine", label: "My own" },
  { value: "web", label: "Websites" },
  { value: "cook", label: "Cooks" },
];

/** The default order is best match once there's a query, else newest. */
export function sortOptions(hasQuery: boolean) {
  return [
    {
      value: "default" as const,
      label: hasQuery ? "Best match" : "Recently added",
    },
    { value: "name" as const, label: "A–Z" },
    { value: "time" as const, label: "Quickest first" },
  ];
}

export function timeLabel(minutes: number): string {
  const option = TIME_OPTIONS.find((item) => item.minutes === minutes);
  return `Under ${option?.label ?? `${minutes} min`}`;
}

/** Filters that narrow the results (sort only reorders them). */
export function activeFilterCount(filters: RecipeSearchFilters): number {
  return (
    (filters.maxTotalTime == null ? 0 : 1) +
    (filters.source ? 1 : 0) +
    filters.tagIds.length
  );
}
