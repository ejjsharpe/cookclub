import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {},
  getDb: vi.fn(),
  processPushNotificationReceipts: vi.fn(),
  cleanupOrphanedRecipeImportImages: vi.fn(),
}));

vi.mock("@repo/db", () => ({
  getDb: mocks.getDb,
}));

vi.mock("@repo/trpc/server", () => ({
  processPushNotificationReceipts: mocks.processPushNotificationReceipts,
  cleanupOrphanedRecipeImportImages: mocks.cleanupOrphanedRecipeImportImages,
}));

// eslint-disable-next-line import/first
import { scheduled } from "./scheduled";

describe("scheduled tasks", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue(mocks.db);
    mocks.processPushNotificationReceipts.mockResolvedValue({
      checked: 4,
      disabledTokens: 1,
    });
    mocks.cleanupOrphanedRecipeImportImages.mockResolvedValue({
      checked: 3,
      deletedJobs: 2,
      expiredJobs: 1,
    });
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it("reconciles import staging alongside push receipts", async () => {
    const imageService = { deleteImportImages: vi.fn() };
    const env = { IMAGE_SERVICE: imageService };

    await scheduled({} as any, env as any, {} as any);

    expect(mocks.processPushNotificationReceipts).toHaveBeenCalledWith(
      mocks.db,
      env,
    );
    expect(mocks.cleanupOrphanedRecipeImportImages).toHaveBeenCalledWith(
      mocks.db,
      imageService,
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      JSON.stringify({
        task: "recipe-import-image-cleanup",
        checked: 3,
        deletedJobs: 2,
        expiredJobs: 1,
      }),
    );
  });
});
