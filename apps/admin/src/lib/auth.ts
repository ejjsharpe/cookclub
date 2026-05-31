import { adminClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { getApiBaseUrl } from "./runtime-config";

export const authClient = createAuthClient({
  baseURL: getApiBaseUrl(),
  basePath: "/auth",
  fetchOptions: {
    credentials: "include",
  },
  plugins: [adminClient()],
});
