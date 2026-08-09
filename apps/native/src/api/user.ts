import type { Outputs } from "@repo/trpc/client";
import { useTRPC } from "@repo/trpc/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { invalidateUserIdentityQueries } from "./utils/cache-helpers";

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
        await invalidateUserIdentityQueries(queryClient, trpc);
        return;
      }

      await queryClient.invalidateQueries(trpc.user.getUser.queryFilter());
    },
  });
};

export const useCompleteOnboarding = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation({
    ...trpc.user.completeOnboarding.mutationOptions(),
    onSuccess: async () => {
      await invalidateUserIdentityQueries(queryClient, trpc);
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
      await clearLocalSessionState(queryClient);
    },
  });
};
