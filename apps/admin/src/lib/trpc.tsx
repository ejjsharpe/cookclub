import {
  TRPCProvider as BaseTRPCProvider,
  createTRPCClient,
} from "@repo/trpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";

import { getTrpcUrl } from "./runtime-config";

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            staleTime: 15_000,
          },
        },
      }),
  );
  const [trpcClient] = useState(() =>
    createTRPCClient({
      apiUrl: getTrpcUrl(),
      credentials: "include",
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <BaseTRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {children}
      </BaseTRPCProvider>
    </QueryClientProvider>
  );
}
