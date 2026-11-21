import type { Outputs } from "@repo/trpc/client";
import { useTRPC } from "@repo/trpc/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { forgetEmail } from "@/lib/knownEmails";
import { clearLocalSessionState } from "@/lib/sessionCleanup";

// API Response Types
export type User = Outputs["user"]["getUser"]["user"];

export const useUser = (
  { enabled = true }: { enabled?: boolean } = { enabled: true },
) => {
  const trpc = useTRPC();

  return useQuery({ ...trpc.user.getUser.queryOptions(), enabled });
};

export const useUpdateProfile = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation({
    ...trpc.user.updateProfile.mutationOptions(),
    onSuccess: async (_data, variables) => {
      const changesPublicIdentity =
        variables.name !== undefined ||
        variables.username !== undefined ||
        variables.bio !== undefined;

      if (changesPublicIdentity) {
        await Promise.all([
          queryClient.invalidateQueries(trpc.user.getUser.pathFilter()),
          queryClient.invalidateQueries(trpc.follows.pathFilter()),
          queryClient.invalidateQueries(trpc.activity.pathFilter()),
          queryClient.invalidateQueries(trpc.collection.pathFilter()),
          queryClient.invalidateQueries(trpc.comment.pathFilter()),
          queryClient.invalidateQueries(trpc.recipe.pathFilter()),
          queryClient.invalidateQueries(trpc.mealPlan.pathFilter()),
          queryClient.invalidateQueries(trpc.shopping.pathFilter()),
          queryClient.invalidateQueries(trpc.notification.pathFilter()),
        ]);
        return;
      }

      await queryClient.invalidateQueries({
        queryKey: trpc.user.getUser.queryKey(),
        exact: true,
      });
    },
  });
};

export const useCompleteOnboarding = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation({
    ...trpc.user.completeOnboarding.mutationOptions(),
    onSuccess: async () => {
      // Leave onboarding now rather than when the refetch below lands,
      // which may never happen if it fails
      queryClient.setQueryData(trpc.user.getUser.queryKey(), (old) =>
        old?.user
          ? { ...old, user: { ...old.user, onboardingCompleted: true } }
          : old,
      );
      await Promise.all([
        queryClient.invalidateQueries(trpc.user.getUser.pathFilter()),
        queryClient.invalidateQueries(trpc.follows.pathFilter()),
        queryClient.invalidateQueries(trpc.activity.pathFilter()),
        queryClient.invalidateQueries(trpc.collection.pathFilter()),
        queryClient.invalidateQueries(trpc.comment.pathFilter()),
        queryClient.invalidateQueries(trpc.recipe.pathFilter()),
        queryClient.invalidateQueries(trpc.mealPlan.pathFilter()),
        queryClient.invalidateQueries(trpc.shopping.pathFilter()),
        queryClient.invalidateQueries(trpc.notification.pathFilter()),
      ]);
    },
  });
};

export const useCheckUsername = (username: string) => {
  const trpc = useTRPC();

  return useQuery({
    ...trpc.user.checkUsername.queryOptions({ username }),
    enabled: username.length >= 3,
  });
};

export const useDeleteAccount = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation({
    ...trpc.user.deleteAccount.mutationOptions(),
    onSuccess: async () => {
      const email = queryClient.getQueryData(trpc.user.getUser.queryKey())?.user
        ?.email;
      if (email) forgetEmail(email);
      await clearLocalSessionState(queryClient);
    },
  });
};
