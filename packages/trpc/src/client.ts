import {
  createTRPCClient as _createTRPCClient,
  httpBatchLink,
} from "@trpc/client";
import { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { createTRPCContext } from "@trpc/tanstack-react-query";

import type { AppRouter } from "./server";

export const createTRPCClient = ({
  apiUrl,
  getCookie,
  credentials,
}: {
  apiUrl: string;
  // Better Auth's Expo client reads cookies from async storage (1.7+).
  getCookie?: () =>
    string | null | undefined | Promise<string | null | undefined>;
  credentials?: "include" | "same-origin" | "omit";
}) => {
  return _createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: apiUrl,
        ...(credentials && {
          fetch: (url, options) =>
            fetch(url, {
              ...options,
              credentials,
            } as RequestInit),
        }),
        async headers() {
          const cookie = await getCookie?.();
          if (!cookie) return {};

          return {
            cookie,
          };
        },
      }),
    ],
  });
};

export type Inputs = inferRouterInputs<AppRouter>;
export type Outputs = inferRouterOutputs<AppRouter>;

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();
