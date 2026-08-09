import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cleanupOrphanedRecipeImportImages,
  cleanupRecipeImportImagesBestEffort,
} from "./cleanup";

function deleteBuilder(expiredJobs: { id: string }[]) {
  const builder = {
    where: vi.fn(() => builder),
    returning: vi.fn().mockResolvedValue(expiredJobs),
  };
  return builder;
}

function selectBuilder(jobs: { id: string; status: string }[]) {
  const builder = {
    from: vi.fn(() => builder),
    where: vi.fn().mockResolvedValue(jobs),
  };
  return builder;
}

describe("recipe import image cleanup", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reports a successful best-effort cleanup", async () => {
    const imageService = {
      deleteImportImages: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      cleanupRecipeImportImagesBestEffort(imageService as never, "job-1"),
    ).resolves.toBe(true);
    expect(imageService.deleteImportImages).toHaveBeenCalledWith("job-1");
  });

  it("contains cleanup failures and logs only a safe error summary", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const imageService = {
      deleteImportImages: vi
        .fn()
        .mockRejectedValue(new Error("R2 unavailable")),
    };

    await expect(
      cleanupRecipeImportImagesBestEffort(imageService as never, "job-1"),
    ).resolves.toBe(false);
    expect(JSON.parse(errorSpy.mock.calls[0]?.[0] as string)).toEqual({
      event: "recipe_import_image_cleanup_failed",
      jobId: "job-1",
      message: "R2 unavailable",
    });
  });

  it("deletes expired terminal jobs and staging prefixes without a retained job", async () => {
    const deletion = deleteBuilder([{ id: "expired-ready" }]);
    const db = {
      delete: vi.fn(() => deletion),
      select: vi.fn(() =>
        selectBuilder([
          { id: "pending", status: "pending" },
          { id: "ready", status: "ready" },
          { id: "failed", status: "failed" },
        ]),
      ),
    };
    const imageService = {
      deleteImportImageStagingIds: vi.fn().mockResolvedValue(undefined),
      listImportImageStagingIds: vi
        .fn()
        .mockResolvedValue(["pending", "ready", "failed", "orphan"]),
    };

    await expect(
      cleanupOrphanedRecipeImportImages(
        db as never,
        imageService as never,
        new Date("2026-08-09T12:00:00Z"),
      ),
    ).resolves.toEqual({ checked: 4, deletedJobs: 2, expiredJobs: 1 });
    expect(imageService.deleteImportImageStagingIds).toHaveBeenNthCalledWith(
      1,
      ["expired-ready"],
    );
    expect(imageService.deleteImportImageStagingIds).toHaveBeenNthCalledWith(
      2,
      ["failed", "orphan"],
    );
  });

  it("reconciles image prefixes in bounded batches", async () => {
    const ids = Array.from({ length: 205 }, (_, index) => `job-${index}`);
    const deletion = deleteBuilder([]);
    const db = {
      delete: vi.fn(() => deletion),
      select: vi.fn(() => selectBuilder([])),
    };
    const imageService = {
      deleteImportImageStagingIds: vi.fn().mockResolvedValue(undefined),
      listImportImageStagingIds: vi.fn().mockResolvedValue(ids),
    };

    const result = await cleanupOrphanedRecipeImportImages(
      db as never,
      imageService as never,
    );

    expect(db.select).toHaveBeenCalledTimes(3);
    expect(imageService.deleteImportImageStagingIds).toHaveBeenCalledOnce();
    expect(imageService.deleteImportImageStagingIds).toHaveBeenCalledWith(ids);
    expect(result).toEqual({ checked: 205, deletedJobs: 205, expiredJobs: 0 });
  });
});
