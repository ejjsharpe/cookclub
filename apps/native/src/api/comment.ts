import type { Outputs } from "@repo/trpc/client";
import { useTRPC } from "@repo/trpc/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// API Response Types
export type CommentWithReplies =
  Outputs["comment"]["getComments"]["comments"][number];
export type Comment = Omit<CommentWithReplies, "replies">;

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
        queryClient.invalidateQueries(trpc.comment.getComments.pathFilter());
        queryClient.invalidateQueries({
          queryKey: trpc.activity.getActivity.queryKey({
            activityEventId: variables.activityEventId,
          }),
        });
        queryClient.invalidateQueries(trpc.activity.getFeed.pathFilter());
        queryClient.invalidateQueries(
          trpc.activity.getUserActivities.pathFilter(),
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
        queryClient.invalidateQueries(trpc.comment.getComments.pathFilter());
        queryClient.invalidateQueries({
          queryKey: trpc.activity.getActivity.queryKey({ activityEventId }),
        });
        queryClient.invalidateQueries(trpc.activity.getFeed.pathFilter());
        queryClient.invalidateQueries(
          trpc.activity.getUserActivities.pathFilter(),
        );
      },
    }),
  );
};
