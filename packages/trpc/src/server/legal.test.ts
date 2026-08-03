import { describe, expect, it, vi } from "vitest";

import { hasAcceptedCurrentTerms, requireCurrentTerms } from "./legal";

function createDb(result: unknown[]) {
  const query = {
    from: vi.fn(() => query),
    where: vi.fn(() => query),
    limit: vi.fn().mockResolvedValue(result),
  };
  return { select: vi.fn(() => query) };
}

describe("current Terms guard", () => {
  it("accepts a user with a record for the current version", async () => {
    const db = createDb([{ id: 1 }]);
    await expect(hasAcceptedCurrentTerms(db as never, "user-1")).resolves.toBe(
      true,
    );
    await expect(
      requireCurrentTerms(db as never, "user-1"),
    ).resolves.toBeUndefined();
  });

  it("returns the typed release-compatible error when acceptance is missing", async () => {
    const db = createDb([]);
    await expect(
      requireCurrentTerms(db as never, "user-1"),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      appCode: "TERMS_ACCEPTANCE_REQUIRED",
    });
  });
});
