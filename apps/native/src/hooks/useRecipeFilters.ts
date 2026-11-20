import { useCallback, useState } from "react";

import { useUserRecipeTags } from "@/api/recipe";

export const useRecipeFilters = () => {
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [maxTotalTime, setMaxTotalTime] = useState<string | undefined>();
  const { data: allTags } = useUserRecipeTags();

  const hasActiveFilters =
    selectedTagIds.length > 0 || maxTotalTime !== undefined;

  const clearFilters = useCallback(() => {
    setSelectedTagIds([]);
    setMaxTotalTime(undefined);
  }, []);

  return {
    // Filter state
    selectedTagIds,
    setSelectedTagIds,
    maxTotalTime,
    setMaxTotalTime,
    clearFilters,
    hasActiveFilters,

    // Filter sheet props
    allTags: allTags ?? [],

    // Parsed values for queries
    parsedTagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
    parsedMaxTotalTime: maxTotalTime ? parseInt(maxTotalTime, 10) : undefined,
  };
};
