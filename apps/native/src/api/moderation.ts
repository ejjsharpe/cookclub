import { useTRPC } from "@repo/trpc/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function useCreateReport() {
  const trpc = useTRPC();
  return useMutation(trpc.moderation.createReport.mutationOptions());
}

export function useBlockUser() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return useMutation({
    ...trpc.moderation.blockUser.mutationOptions(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries(trpc.moderation.pathFilter()),
        queryClient.invalidateQueries(trpc.follows.pathFilter()),
        queryClient.invalidateQueries(trpc.activity.pathFilter()),
        queryClient.invalidateQueries(trpc.comment.pathFilter()),
        queryClient.invalidateQueries(trpc.recipe.pathFilter()),
        queryClient.invalidateQueries(trpc.mealPlan.pathFilter()),
        queryClient.invalidateQueries(trpc.shopping.pathFilter()),
        queryClient.invalidateQueries(trpc.notification.pathFilter()),
      ]);
    },
  });
}

export function useUnblockUser() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return useMutation({
    ...trpc.moderation.unblockUser.mutationOptions(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries(trpc.moderation.pathFilter()),
        queryClient.invalidateQueries(trpc.follows.pathFilter()),
        queryClient.invalidateQueries(trpc.activity.pathFilter()),
        queryClient.invalidateQueries(trpc.comment.pathFilter()),
        queryClient.invalidateQueries(trpc.recipe.pathFilter()),
        queryClient.invalidateQueries(trpc.mealPlan.pathFilter()),
        queryClient.invalidateQueries(trpc.shopping.pathFilter()),
        queryClient.invalidateQueries(trpc.notification.pathFilter()),
      ]);
    },
  });
}

export function useBlockedUsers() {
  const trpc = useTRPC();
  return useQuery(trpc.moderation.listBlockedUsers.queryOptions());
}
