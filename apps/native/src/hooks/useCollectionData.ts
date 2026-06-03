import { useMemo } from "react";

import { useGetUserCollectionsWithMetadata } from "@/api/collection";

export type CollectionWithMetadata = NonNullable<
  ReturnType<typeof useGetUserCollectionsWithMetadata>["data"]
>[number];

const EMPTY_COLLECTIONS: CollectionWithMetadata[] = [];

interface UseCollectionDataOptions {
  search?: string;
}

export const useCollectionData = ({
  search,
}: UseCollectionDataOptions = {}) => {
  const {
    data: collectionsData,
    isPending,
    refetch,
    error,
  } = useGetUserCollectionsWithMetadata({
    search,
  });

  const collections = useMemo(() => {
    return collectionsData ?? EMPTY_COLLECTIONS;
  }, [collectionsData]);

  return {
    collections,
    isPending,
    error,
    refetch,
  };
};
