import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@repo/db/schemas", () => ({
  recipeImportJobs: {
    id: "id",
    status: "status",
    updatedAt: "updatedAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions) => ({ type: "and", conditions })),
  eq: vi.fn((field, value) => ({ type: "eq", field, value })),
  inArray: vi.fn((field, values) => ({ type: "inArray", field, values })),
  lt: vi.fn((field, value) => ({ type: "lt", field, value })),
  or: vi.fn((...conditions) => ({ type: "or", conditions })),
}));

// eslint-disable-next-line import/first
import { cleanupOrphanedRecipeImportImages } from "./recipe-import-image-cleanup.service";

function createDb(
  jobs: Record<string, "pending" | "processing" | "ready" | "failed">,
  expiredJobIds: string[] = [],
) {
  return {
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(async () => expiredJobIds.map((id) => ({ id }))),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async (condition: { values: string[] }) =>
          condition.values.flatMap((id) =>
            jobs[id] ? [{ id, status: jobs[id] }] : [],
          ),
        ),
      })),
    })),
  };
}

describe("recipe import image cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes failed and missing job prefixes while retaining active jobs", async () => {
    const listImportImageStagingIds = vi
      .fn()
      .mockResolvedValue([
        "ready-job",
        "failed-job",
        "missing-job",
        "processing-job",
      ]);
    const deleteImportImageStagingIds = vi.fn().mockResolvedValue(undefined);
    const db = createDb({
      "ready-job": "ready",
      "failed-job": "failed",
      "processing-job": "processing",
    });

    const result = await cleanupOrphanedRecipeImportImages(
      db as any,
      {
        listImportImageStagingIds,
        deleteImportImageStagingIds,
      } as any,
    );

    expect(listImportImageStagingIds).toHaveBeenCalledOnce();
    expect(deleteImportImageStagingIds).toHaveBeenCalledOnce();
    expect(deleteImportImageStagingIds).toHaveBeenCalledWith([
      "failed-job",
      "missing-job",
    ]);
    expect(result).toEqual({
      checked: 4,
      deletedJobs: 2,
      expiredJobs: 0,
    });
  });

  it("expires terminal jobs before reconciling their staging prefixes", async () => {
    const deleteImportImageStagingIds = vi.fn().mockResolvedValue(undefined);
    const db = createDb({}, ["old-ready-job", "old-failed-job"]);
    const imageService = {
      listImportImageStagingIds: vi.fn().mockResolvedValue([]),
      deleteImportImageStagingIds,
    };

    const result = await cleanupOrphanedRecipeImportImages(
      db as any,
      imageService as any,
      new Date("2026-07-24T10:00:00.000Z"),
    );

    expect(db.delete).toHaveBeenCalledWith(expect.anything());
    expect(deleteImportImageStagingIds).toHaveBeenCalledWith([
      "old-ready-job",
      "old-failed-job",
    ]);
    expect(result).toEqual({
      checked: 0,
      deletedJobs: 0,
      expiredJobs: 2,
    });
  });

  it("propagates deletion failures so the scheduled task can be retried", async () => {
    const error = new Error("R2 unavailable");
    const db = createDb({});
    const imageService = {
      listImportImageStagingIds: vi.fn().mockResolvedValue(["missing-job"]),
      deleteImportImageStagingIds: vi.fn().mockRejectedValue(error),
    };

    await expect(
      cleanupOrphanedRecipeImportImages(db as any, imageService as any),
    ).rejects.toBe(error);
  });
});
