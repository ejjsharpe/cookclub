import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {},
  getDb: vi.fn(),
  processPushNotificationReceipts: vi.fn(),
  cleanupOrphanedRecipeImportImages: vi.fn(),
  recoverStaleRecipeImportJobs: vi.fn(),
}));

vi.mock("@repo/db", () => ({
  getDb: mocks.getDb,
}));

vi.mock("@repo/trpc/server", () => ({
  processPushNotificationReceipts: mocks.processPushNotificationReceipts,
  cleanupOrphanedRecipeImportImages: mocks.cleanupOrphanedRecipeImportImages,
  recoverStaleRecipeImportJobs: mocks.recoverStaleRecipeImportJobs,
}));

// eslint-disable-next-line import/first
import { scheduled } from "./scheduled";

describe("scheduled tasks", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

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
    mocks.recoverStaleRecipeImportJobs.mockResolvedValue({
      checked: 2,
      recovered: 1,
    });
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
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
    expect(mocks.recoverStaleRecipeImportJobs).toHaveBeenCalledWith({
      db: mocks.db,
      env,
    });
    expect(consoleLogSpy).toHaveBeenCalledWith(
      JSON.stringify({
        task: "recipe-import-image-cleanup",
        checked: 3,
        deletedJobs: 2,
        expiredJobs: 1,
      }),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      JSON.stringify({
        task: "recipe-import-stale-recovery",
        checked: 2,
        recovered: 1,
      }),
    );
  });

  it("defers a transient database failure while completing the other task", async () => {
    const connectionError = Object.assign(
      new Error("Failed to acquire a connection from the pool."),
      { code: "58000" },
    );
    const queryError = Object.assign(new Error("Failed query"), {
      cause: connectionError,
    });
    mocks.processPushNotificationReceipts.mockRejectedValue(queryError);

    await scheduled({} as any, { IMAGE_SERVICE: {} } as any, {} as any);

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      JSON.stringify({
        task: "push-notification-receipts",
        status: "deferred",
        reason: "transient-infrastructure-error",
        error: {
          name: "Error",
          message: "Failed to acquire a connection from the pool.",
          code: "58000",
        },
      }),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      JSON.stringify({
        task: "recipe-import-image-cleanup",
        checked: 3,
        deletedJobs: 2,
        expiredJobs: 1,
      }),
    );
    expect(consoleLogSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('"task":"push-notification-receipts"'),
    );
  });

  it("still rejects unexpected scheduled task failures", async () => {
    mocks.processPushNotificationReceipts.mockRejectedValue(
      new Error("Unexpected receipt failure"),
    );

    await expect(
      scheduled({} as any, { IMAGE_SERVICE: {} } as any, {} as any),
    ).rejects.toThrow("Unexpected receipt failure");

    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });
});
