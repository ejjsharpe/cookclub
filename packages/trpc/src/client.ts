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
  getCookie?: () => string | undefined;
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
        headers() {
          const cookie = getCookie?.();
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
