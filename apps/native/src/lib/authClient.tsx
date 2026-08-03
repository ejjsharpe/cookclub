import { expoClient } from "@better-auth/expo/client";
import type { BetterAuthClientPlugin } from "better-auth";
import { createAuthClient } from "better-auth/react";

import { storage } from "./mmkv";
import { getAuthBaseUrl } from "./runtimeConfig";

const expoAuthPlugin = expoClient({
  scheme: "cookclub",
  storagePrefix: "cookclub",
  storage: {
    getItem: (key) => storage.getString(key) ?? null,
    setItem: (key, val) => storage.set(key, val),
  },
});

export const authClient = createAuthClient({
  baseURL: getAuthBaseUrl(),
  basePath: "/auth",
  plugins: [expoAuthPlugin as unknown as BetterAuthClientPlugin],
});

// Better Auth 1.6.25 and its Expo plugin currently expose structurally
// incompatible generic BetterFetch types under TypeScript 6. Runtime versions
// are identical, so retain the action added when createAuthClient initializes
// the plugin without invoking the plugin lifecycle manually.
const expoAuthClient = authClient as typeof authClient & {
  getCookie: () => string;
};

export const getAuthCookie = () => expoAuthClient.getCookie();
