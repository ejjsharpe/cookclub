import type { Outputs } from "@repo/trpc/client";
import { useTRPC } from "@repo/trpc/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type SubscriptionStatus = Outputs["subscription"]["getStatus"];

export const useSubscriptionStatus = (enabled = true) => {
  const trpc = useTRPC();

  return useQuery({
    ...trpc.subscription.getStatus.queryOptions(),
    enabled,
  });
};

export const useRefreshSubscriptionEntitlement = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation({
    ...trpc.subscription.refreshEntitlement.mutationOptions(),
    onSuccess: (status) => {
      const statusKey = trpc.subscription.getStatus.queryKey();
      const previous = queryClient.getQueryData<SubscriptionStatus>(statusKey);
      queryClient.setQueryData(statusKey, status);

      if (previous?.isPro === status.isPro) return;

      queryClient.invalidateQueries(trpc.recipe.getRecipeDetail.pathFilter());
      queryClient.invalidateQueries(trpc.recipeImport.get.pathFilter());
    },
  });
};
