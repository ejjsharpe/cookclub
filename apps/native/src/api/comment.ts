import type { Outputs } from "@repo/trpc/client";
import { useTRPC } from "@repo/trpc/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// API Response Types
export type CommentWithReplies =
  Outputs["comment"]["getComments"]["comments"][number];
type CurrentComment = Omit<CommentWithReplies, "replies">;
export type Comment = Omit<CurrentComment, "mentions"> & {
  // Persisted v1 query data predates mention metadata.
  mentions?: CurrentComment["mentions"];
};

export const useCommentMentionSuggestions = (
  query: string,
  limit = 5,
  enabled = query.length >= 1,
) => {
  const trpc = useTRPC();

  return useQuery({
    ...trpc.follows.searchUsers.queryOptions({ query, limit }),
    enabled,
    placeholderData: (previousData) => previousData,
  });
};

// Get comments for an activity event
export const useComments = (
  activityEventId: number,
  focusedCommentId?: number,
) => {
  const trpc = useTRPC();

  return useQuery({
    ...trpc.comment.getComments.queryOptions({
      activityEventId,
      ...(focusedCommentId === undefined ? {} : { focusedCommentId }),
    }),
    enabled: Number.isInteger(activityEventId) && activityEventId > 0,
  });
};

// Create a new comment
export const useCreateComment = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.comment.createComment.mutationOptions({
      onSuccess: (_data, variables) => {
        if (variables.parentCommentId === undefined) {
          queryClient.invalidateQueries({
            queryKey: trpc.activity.getActivity.queryKey({
              activityEventId: variables.activityEventId,
            }),
            exact: true,
          });
          queryClient.invalidateQueries(trpc.activity.getFeed.pathFilter());
          queryClient.invalidateQueries(
            trpc.activity.getUserActivities.pathFilter(),
          );
        }

        return queryClient.invalidateQueries(
          trpc.comment.getComments.queryFilter({
            activityEventId: variables.activityEventId,
          }),
        );
      },
    }),
  );
};

// Delete a comment
export const useDeleteComment = (activityEventId: number) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.comment.deleteComment.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.activity.getActivity.queryKey({ activityEventId }),
          exact: true,
        });
        queryClient.invalidateQueries(trpc.activity.getFeed.pathFilter());
        queryClient.invalidateQueries(
          trpc.activity.getUserActivities.pathFilter(),
        );

        return queryClient.invalidateQueries(
          trpc.comment.getComments.queryFilter({ activityEventId }),
        );
      },
    }),
  );
};
