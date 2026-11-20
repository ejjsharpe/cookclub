import type { Outputs } from "@repo/trpc/client";
import { useTRPC } from "@repo/trpc/client";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useRef } from "react";

import { useSessionContext } from "@/lib/sessionContext";
import { getRecipeImportSourceDescription } from "@/utils/activityDescription";
import { formatRelativeTimeShort } from "@/utils/relativeTime";

// API Response Types
export type FeedItem = Outputs["activity"]["getFeed"]["items"][number];
export type RecipeImportFeedItem = Extract<FeedItem, { type: "recipe_import" }>;
export type CookingReviewFeedItem = Extract<
  FeedItem,
  { type: "cooking_review" }
>;
export type ActivityFeedListItem = FeedItem & {
  _display: {
    timeAgo: string;
    sourceDescription?: string;
  };
};

const ACTIVITY_FEED_STALE_TIME = 1000 * 60 * 5;

export const useActivity = (activityEventId: number) => {
  const trpc = useTRPC();

  return useQuery({
    ...trpc.activity.getActivity.queryOptions({ activityEventId }),
    staleTime: 0,
    enabled: Number.isInteger(activityEventId) && activityEventId > 0,
  });
};

// Get activity feed with infinite scroll
interface UseActivityFeedParams {
  limit?: number;
}

type ActivityPage = { items: FeedItem[] };

const getSourceDescription = (item: FeedItem): string | undefined => {
  if (item.type !== "recipe_import") return undefined;
  return getRecipeImportSourceDescription(item.recipe);
};

function useActivityItemsSelector<TPage extends ActivityPage>() {
  const lastSelectionRef = useRef<{
    pages: TPage[];
    items: ActivityFeedListItem[];
  } | null>(null);
  const itemSelectionCache = useRef<WeakMap<FeedItem, ActivityFeedListItem>>(
    new WeakMap(),
  );

  return (data: InfiniteData<TPage>) => {
    const previous = lastSelectionRef.current;
    if (
      previous &&
      previous.pages.length === data.pages.length &&
      previous.pages.every((page, index) => page === data.pages[index])
    ) {
      return previous.items;
    }

    const items = data.pages.flatMap((page) =>
      (page?.items ?? []).map((item) => {
        const cached = itemSelectionCache.current.get(item);
        if (cached) return cached;

        const selectedItem = {
          ...item,
          _display: {
            timeAgo: formatRelativeTimeShort(item.createdAt),
            sourceDescription: getSourceDescription(item),
          },
        } as ActivityFeedListItem;
        itemSelectionCache.current.set(item, selectedItem);
        return selectedItem;
      }),
    );
    lastSelectionRef.current = {
      pages: data.pages,
      items,
    };
    return items;
  };
}

export const useActivityFeed = ({ limit = 20 }: UseActivityFeedParams = {}) => {
  const trpc = useTRPC();
  const selectActivityItems = useActivityItemsSelector<FeedPage>();

  const infiniteQueryOptions = trpc.activity.getFeed.infiniteQueryOptions(
    { limit },
    { getNextPageParam: (lastPage) => lastPage?.nextCursor },
  );

  return useInfiniteQuery({
    ...infiniteQueryOptions,
    staleTime: ACTIVITY_FEED_STALE_TIME,
    refetchOnWindowFocus: false,
    select: selectActivityItems,
  });
};

// Create cooking review mutation
export const useCreateCookingReview = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const userId = useSessionContext()?.user.id;

  return useMutation(
    trpc.activity.createCookingReview.mutationOptions({
      onSuccess: async (_data, variables) => {
        queryClient.invalidateQueries(trpc.activity.getFeed.pathFilter());
        queryClient.invalidateQueries(
          userId
            ? trpc.activity.getUserActivities.infiniteQueryFilter({ userId })
            : trpc.activity.getUserActivities.pathFilter(),
        );
        queryClient.invalidateQueries(
          trpc.collection.getUserCollections.pathFilter(),
        );
        queryClient.invalidateQueries(
          trpc.collection.getCollectionDetail.pathFilter(),
        );

        await Promise.all([
          queryClient.invalidateQueries(
            trpc.activity.getRecipeReviews.infiniteQueryFilter({
              recipeId: variables.recipeId,
            }),
          ),
          queryClient.invalidateQueries({
            queryKey: trpc.activity.getRecipeRating.queryKey({
              recipeId: variables.recipeId,
            }),
            exact: true,
          }),
          queryClient.invalidateQueries({
            queryKey: trpc.recipe.getRecipeDetail.queryKey({
              recipeId: variables.recipeId,
            }),
            exact: true,
          }),
        ]);
      },
    }),
  );
};

// Get activities for a specific user (for profile pages)
interface UseUserActivitiesParams {
  userId: string;
  limit?: number;
  /** Only reviews, or only saves. Leave out for everything. */
  type?: FeedItem["type"];
}

export const useUserActivities = ({
  userId,
  limit = 20,
  type,
}: UseUserActivitiesParams) => {
  const trpc = useTRPC();
  const selectActivityItems = useActivityItemsSelector<UserActivitiesPage>();

  const infiniteQueryOptions =
    trpc.activity.getUserActivities.infiniteQueryOptions(
      type ? { userId, limit, type } : { userId, limit },
      { getNextPageParam: (lastPage) => lastPage?.nextCursor },
    );

  return useInfiniteQuery({
    ...infiniteQueryOptions,
    staleTime: ACTIVITY_FEED_STALE_TIME,
    refetchOnWindowFocus: false,
    select: selectActivityItems,
  });
};

// Infinite query data structure
interface InfiniteData<T> {
  pages: T[];
  pageParams: unknown[];
}

type FeedPage = ActivityPage & { nextCursor: string | null };
type UserActivitiesPage = ActivityPage & { nextCursor: number | null };

function updateActivityPages<TPage extends { items: FeedItem[] }>(
  old: InfiniteData<TPage> | undefined,
  activityEventId: number,
  updateItem: (item: FeedItem) => FeedItem,
): InfiniteData<TPage> | undefined {
  if (!old?.pages) return old;

  const targetId = String(activityEventId);
  let didChange = false;
  const pages = old.pages.map((page) => {
    const itemIndex = page.items.findIndex((item) => item.id === targetId);
    if (itemIndex === -1) return page;

    const nextItem = updateItem(page.items[itemIndex]!);
    if (nextItem === page.items[itemIndex]) return page;

    didChange = true;
    const items = page.items.slice();
    items[itemIndex] = nextItem;
    return {
      ...page,
      items,
    };
  });

  if (!didChange) return old;
  return {
    ...old,
    pages,
  };
}

// Toggle like mutation with optimistic updates on feed items
export const useToggleActivityLike = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.activity.toggleLike.mutationOptions({
      onMutate: async ({ activityEventId }) => {
        // Cancel outgoing feed refetches
        await queryClient.cancelQueries(trpc.activity.getFeed.pathFilter());
        await queryClient.cancelQueries(
          trpc.activity.getUserActivities.pathFilter(),
        );
        const activityQueryKey = trpc.activity.getActivity.queryKey({
          activityEventId,
        });
        await queryClient.cancelQueries({
          queryKey: activityQueryKey,
          exact: true,
        });

        // Snapshot previous feed data
        const previousFeedData = queryClient.getQueriesData<
          InfiniteData<FeedPage>
        >(trpc.activity.getFeed.pathFilter());
        const previousUserActivitiesData = queryClient.getQueriesData<
          InfiniteData<UserActivitiesPage>
        >(trpc.activity.getUserActivities.pathFilter());
        const previousActivityData =
          queryClient.getQueryData<FeedItem>(activityQueryKey);

        // Helper to update feed items
        const updateFeedItem = (item: FeedItem): FeedItem => ({
          ...item,
          isLiked: !item.isLiked,
          likeCount: item.isLiked ? item.likeCount - 1 : item.likeCount + 1,
        });

        // Optimistically update getFeed queries
        queryClient.setQueriesData<InfiniteData<FeedPage>>(
          trpc.activity.getFeed.pathFilter(),
          (old) => updateActivityPages(old, activityEventId, updateFeedItem),
        );

        // Optimistically update getUserActivities queries
        queryClient.setQueriesData<InfiniteData<UserActivitiesPage>>(
          trpc.activity.getUserActivities.pathFilter(),
          (old) => updateActivityPages(old, activityEventId, updateFeedItem),
        );
        queryClient.setQueryData<FeedItem>(activityQueryKey, (old) =>
          old ? updateFeedItem(old) : old,
        );

        return {
          previousFeedData,
          previousUserActivitiesData,
          previousActivityData,
        };
      },
      onError: (_err, _variables, context) => {
        // Rollback on error
        if (context?.previousFeedData) {
          for (const [queryKey, data] of context.previousFeedData) {
            queryClient.setQueryData(queryKey, data);
          }
        }
        if (context?.previousUserActivitiesData) {
          for (const [queryKey, data] of context.previousUserActivitiesData) {
            queryClient.setQueryData(queryKey, data);
          }
        }
        if (context?.previousActivityData) {
          queryClient.setQueryData(
            trpc.activity.getActivity.queryKey({
              activityEventId: _variables.activityEventId,
            }),
            context.previousActivityData,
          );
        }
      },
      onSuccess: (data, { activityEventId }) => {
        // Sync server-returned count with cache (in case of race conditions)
        const updateWithServerData = (item: FeedItem): FeedItem => {
          if (
            item.isLiked === data.liked &&
            item.likeCount === data.likeCount
          ) {
            return item;
          }
          return {
            ...item,
            isLiked: data.liked,
            likeCount: data.likeCount,
          };
        };

        queryClient.setQueriesData<InfiniteData<FeedPage>>(
          trpc.activity.getFeed.pathFilter(),
          (old) =>
            updateActivityPages(old, activityEventId, updateWithServerData),
        );

        queryClient.setQueriesData<InfiniteData<UserActivitiesPage>>(
          trpc.activity.getUserActivities.pathFilter(),
          (old) =>
            updateActivityPages(old, activityEventId, updateWithServerData),
        );
        queryClient.setQueryData<FeedItem>(
          trpc.activity.getActivity.queryKey({ activityEventId }),
          (old) => (old ? updateWithServerData(old) : old),
        );
      },
    }),
  );
};
