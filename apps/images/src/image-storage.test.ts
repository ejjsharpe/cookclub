import { describe, expect, it, vi } from "vitest";

import { putAndInspectImage } from "./image-storage";

describe("image storage", () => {
  it("returns inspected metadata after committing an image", async () => {
    const bucket = {
      put: vi.fn().mockResolvedValue({}),
      delete: vi.fn(),
    };
    const inspect = vi.fn().mockResolvedValue({ width: 100 });

    await expect(
      putAndInspectImage(
        bucket as unknown as R2Bucket,
        "recipes/covers/recipe/image.jpg",
        new ArrayBuffer(1),
        { httpMetadata: { contentType: "image/jpeg" } },
        inspect,
      ),
    ).resolves.toEqual({ width: 100 });

    expect(bucket.delete).not.toHaveBeenCalled();
  });

  it("deletes the destination when post-write inspection fails", async () => {
    const error = new Error("metadata unavailable");
    const bucket = {
      put: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      putAndInspectImage(
        bucket as unknown as R2Bucket,
        "recipes/covers/recipe/image.jpg",
        new ArrayBuffer(1),
        { httpMetadata: { contentType: "image/jpeg" } },
        vi.fn().mockRejectedValue(error),
      ),
    ).rejects.toBe(error);

    expect(bucket.delete).toHaveBeenCalledWith(
      "recipes/covers/recipe/image.jpg",
    );
  });

  it("attempts destination cleanup when the write itself rejects", async () => {
    const error = new Error("write failed");
    const bucket = {
      put: vi.fn().mockRejectedValue(error),
      delete: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      putAndInspectImage(
        bucket as unknown as R2Bucket,
        "recipes/covers/recipe/image.jpg",
        new ArrayBuffer(1),
        { httpMetadata: { contentType: "image/jpeg" } },
        vi.fn(),
      ),
    ).rejects.toBe(error);

    expect(bucket.delete).toHaveBeenCalledWith(
      "recipes/covers/recipe/image.jpg",
    );
  });
});
