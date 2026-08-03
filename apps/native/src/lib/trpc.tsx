import {
  TRPCProvider as _TRPCProvider,
  createTRPCClient,
} from "@repo/trpc/client";
import { useQueryClient } from "@tanstack/react-query";

import { getAuthCookie } from "./authClient";
import { getApiUrl } from "./runtimeConfig";

export const TRPCProvider = ({ children }: { children: React.ReactNode }) => {
  const queryClient = useQueryClient();

  const trpcClient = createTRPCClient({
    apiUrl: getApiUrl(),
    getCookie: getAuthCookie,
  });

  return (
    <_TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
      {children}
    </_TRPCProvider>
  );
};
