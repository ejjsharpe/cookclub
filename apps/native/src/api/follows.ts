import type { Outputs } from "@repo/trpc/client";
import { useTRPC } from "@repo/trpc/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { invalidateFollowRelatedQueries } from "./utils/cache-helpers";

// API Response Types
export type SearchUser = Outputs["follows"]["searchUsers"][number];

export const useFollowing = () => {
  const trpc = useTRPC();
  return useQuery(trpc.follows.getFollowing.queryOptions());
};

interface UseSearchUsersParams {
  query: string;
  limit?: number;
}

export const useSearchUsers = ({ query, limit = 10 }: UseSearchUsersParams) => {
  const trpc = useTRPC();
  return useQuery({
    ...trpc.follows.searchUsers.queryOptions({ query, limit }),
    enabled: query.length >= 2, // Only search when query is long enough
  });
};

interface UseUserProfileParams {
  userId: string;
}

export const useUserProfile = ({ userId }: UseUserProfileParams) => {
  const trpc = useTRPC();

  return useQuery(trpc.follows.getUserProfile.queryOptions({ userId }));
};

export const useSuggestedUsers = (limit = 10, enabled = true) => {
  const trpc = useTRPC();
  return useQuery({
    ...trpc.follows.getSuggestedUsers.queryOptions({ limit }),
    enabled,
  });
};

// Mutations
export const useFollowUser = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const mutationOptions = trpc.follows.followUser.mutationOptions({
    onSuccess: async () => {
      await invalidateFollowRelatedQueries(queryClient, trpc);
    },
  });

  return useMutation(mutationOptions);
};

export const useUnfollowUser = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation({
    ...trpc.follows.unfollowUser.mutationOptions(),
    onSuccess: async () => {
      await invalidateFollowRelatedQueries(queryClient, trpc);
    },
  });
};

// Get a specific user's followers
interface UseUserFollowersParams {
  userId: string;
}

export const useUserFollowers = ({ userId }: UseUserFollowersParams) => {
  const trpc = useTRPC();
  return useQuery(trpc.follows.getUserFollowers.queryOptions({ userId }));
};

// Get a specific user's following
interface UseUserFollowingParams {
  userId: string;
}

export const useUserFollowing = ({ userId }: UseUserFollowingParams) => {
  const trpc = useTRPC();
  return useQuery(trpc.follows.getUserFollowing.queryOptions({ userId }));
};
