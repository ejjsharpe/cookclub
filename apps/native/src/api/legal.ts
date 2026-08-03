import { CURRENT_TERMS_VERSION } from "@repo/contracts";
import { useTRPC } from "@repo/trpc/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function useLegalStatus(enabled = true) {
  const trpc = useTRPC();
  return useQuery({ ...trpc.legal.getStatus.queryOptions(), enabled });
}

export function useAcceptCurrentTerms() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return useMutation({
    ...trpc.legal.acceptTerms.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries(trpc.legal.getStatus.pathFilter());
    },
  });
}

export const currentTermsAcceptanceInput = {
  termsVersion: CURRENT_TERMS_VERSION,
} as const;
