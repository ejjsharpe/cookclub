import { describe, expect, it } from "vitest";

import { getLogRoute } from "./route";

describe("auth route logging", () => {
  it("redacts reset callback tokens and omits query strings", () => {
    expect(
      getLogRoute(
        "https://api.cookclub.app/auth/reset-password/secret-token?callbackURL=private",
      ),
    ).toBe("/auth/reset-password/:token");
    expect(
      getLogRoute("https://api.cookclub.app/auth/reset-password?token=secret"),
    ).toBe("/auth/reset-password");
  });
});
