import { beforeEach, describe, expect, it, vi } from "vitest";

import { uploadRouter } from "./upload-router";
import { createMockContext } from "../__mocks__/context";

const mocks = vi.hoisted(() => ({ enforceRateLimit: vi.fn() }));

vi.mock("../rate-limit", () => ({ enforceRateLimit: mocks.enforceRateLimit }));

describe("uploadRouter.requestUploadUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enforceRateLimit.mockResolvedValue(undefined);
  });

  it("rate-limits before presigning for the authenticated owner", async () => {
    const presign = vi.fn().mockResolvedValue({
      uploadUrl: "https://upload.example.com",
      publicUrl: "https://images.example.com/key",
      key: "key",
      maxFileSize: 10_000,
      kind: "recipe_photo",
    });
    const ctx = createMockContext({
      env: {
        ...createMockContext().env,
        IMAGE_SERVICE: {
          ...createMockContext().env.IMAGE_SERVICE,
          presign,
        },
      },
    });
    const caller = uploadRouter.createCaller(ctx as never);

    await caller.requestUploadUrl({
      contentType: "image/webp",
      kind: "recipe_photo",
    });

    expect(mocks.enforceRateLimit).toHaveBeenCalledWith(ctx, "upload_presign");
    expect(presign).toHaveBeenCalledWith(
      "image/webp",
      "test-user-id",
      "recipe_photo",
    );
  });

  it("does not call the image service when the limiter rejects", async () => {
    mocks.enforceRateLimit.mockRejectedValue(new Error("rate limited"));
    const ctx = createMockContext();
    const caller = uploadRouter.createCaller(ctx as never);

    await expect(
      caller.requestUploadUrl({ contentType: "image/png", kind: "avatar" }),
    ).rejects.toThrow("rate limited");
    expect(ctx.env.IMAGE_SERVICE.presign).not.toHaveBeenCalled();
  });

  it("rejects unsupported content types during input validation", async () => {
    const ctx = createMockContext();
    const caller = uploadRouter.createCaller(ctx as never);

    await expect(
      caller.requestUploadUrl({
        contentType: "image/gif",
        kind: "avatar",
      } as never),
    ).rejects.toHaveProperty("code", "BAD_REQUEST");
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled();
  });
});
