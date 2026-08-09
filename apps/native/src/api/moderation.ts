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
      await queryClient.invalidateQueries();
    },
  });
}

export function useUnblockUser() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return useMutation({
    ...trpc.moderation.unblockUser.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
    },
  });
}

export function useBlockedUsers() {
  const trpc = useTRPC();
  return useQuery(trpc.moderation.listBlockedUsers.queryOptions());
}
