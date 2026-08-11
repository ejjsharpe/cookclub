import { useTRPC } from "@repo/trpc/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert } from "react-native";

import { updateRecipeCollections } from "./utils/cache-helpers";

// Get user's collections with optional recipe membership info
interface UseGetUserCollectionsParams {
  recipeId?: number;
  includeMetadata?: boolean;
  search?: string;
}

export const useGetUserCollections = ({
  recipeId,
  includeMetadata,
  search,
}: UseGetUserCollectionsParams = {}) => {
  const trpc = useTRPC();

  return useQuery({
    ...trpc.collection.getUserCollections.queryOptions({
      recipeId,
      includeMetadata,
      search: search?.trim() || undefined,
    }),
  });
};

// Create a new collection
export const useCreateCollection = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const mutationOptions = trpc.collection.createCollection.mutationOptions({
    onSuccess: () => {
      // Invalidate collections list to show the new collection
      const collectionsFilter = trpc.collection.getUserCollections.pathFilter();
      queryClient.invalidateQueries(collectionsFilter);
    },
    onError: () => {
      Alert.alert("Error", "Failed to create collection. Please try again.");
    },
  });

  return useMutation(mutationOptions);
};

// Get user's collections with metadata (recipe count, owner info)
interface UseGetUserCollectionsWithMetadataParams {
  search?: string;
}

export const useGetUserCollectionsWithMetadata = ({
  search = "",
}: UseGetUserCollectionsWithMetadataParams = {}) => {
  const trpc = useTRPC();

  return useQuery({
    ...trpc.collection.getUserCollections.queryOptions({
      includeMetadata: true,
      search: search.trim() || undefined,
    }),
  });
};

// Get collection detail with recipes
interface UseGetCollectionDetailParams {
  collectionId: number;
  enabled?: boolean;
}

export const useGetCollectionDetail = ({
  collectionId,
  enabled = true,
}: UseGetCollectionDetailParams) => {
  const trpc = useTRPC();

  return useQuery({
    ...trpc.collection.getCollectionDetail.queryOptions({ collectionId }),
    enabled,
  });
};

// Delete a collection
export const useDeleteCollection = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const mutationOptions = trpc.collection.deleteCollection.mutationOptions({
    onSuccess: (_data, variables) => {
      queryClient.removeQueries({
        queryKey: trpc.collection.getCollectionDetail.queryKey({
          collectionId: variables.collectionId,
        }),
        exact: true,
      });
      queryClient.invalidateQueries(
        trpc.collection.getUserCollections.pathFilter(),
      );
      queryClient.invalidateQueries(trpc.recipe.getRecipeDetail.pathFilter());
    },
    onError: () => {
      Alert.alert("Error", "Failed to delete collection. Please try again.");
    },
  });

  return useMutation(mutationOptions);
};

// Batch update recipe collections (replace all memberships at once)
export const useUpdateRecipeCollections = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const mutationOptions =
    trpc.collection.updateRecipeCollections.mutationOptions({
      onSuccess: (_data, variables) => {
        const { recipeId, collectionIds } = variables;

        // Update recipe detail cache with new collectionIds
        updateRecipeCollections(queryClient, trpc, recipeId, collectionIds);

        queryClient.invalidateQueries(
          trpc.collection.getUserCollections.pathFilter(),
        );
        queryClient.invalidateQueries(
          trpc.collection.getCollectionDetail.pathFilter(),
        );
      },
      onError: () => {
        Alert.alert("Error", "Failed to update collections. Please try again.");
      },
    });

  return useMutation(mutationOptions);
};

// Add one recipe to one collection without replacing other memberships
export const useAddRecipeToCollection = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const mutationOptions = trpc.collection.addRecipeToCollection.mutationOptions(
    {
      onSuccess: (_data, variables) => {
        const { recipeId, collectionId } = variables;

        queryClient.setQueriesData<any>(
          trpc.recipe.getRecipeDetail.pathFilter(),
          (old: any) => {
            if (!old || old.id !== recipeId) return old;

            const collectionIds = Array.isArray(old.collectionIds)
              ? old.collectionIds
              : [];

            if (collectionIds.includes(collectionId)) return old;

            return {
              ...old,
              collectionIds: [...collectionIds, collectionId],
            };
          },
        );

        queryClient.invalidateQueries({
          queryKey: trpc.collection.getCollectionDetail.queryKey({
            collectionId,
          }),
          exact: true,
        });
        queryClient.invalidateQueries(
          trpc.collection.getUserCollections.pathFilter(),
        );
      },
      onError: () => {
        Alert.alert(
          "Error",
          "Failed to add recipe to collection. Please try again.",
        );
      },
    },
  );

  return useMutation(mutationOptions);
};
