import { beforeEach, describe, expect, it, vi } from "vitest";

import { enforceRateLimit } from "./rate-limit";

function createContext(outcomes: {
  ai?: boolean;
  image?: boolean;
  upload?: boolean;
}) {
  return {
    user: { id: "user-1" },
    env: {
      AI_RATE_LIMITER:
        outcomes.ai === undefined
          ? undefined
          : { limit: vi.fn().mockResolvedValue({ success: outcomes.ai }) },
      IMAGE_AI_RATE_LIMITER:
        outcomes.image === undefined
          ? undefined
          : { limit: vi.fn().mockResolvedValue({ success: outcomes.image }) },
      UPLOAD_RATE_LIMITER:
        outcomes.upload === undefined
          ? undefined
          : { limit: vi.fn().mockResolvedValue({ success: outcomes.upload }) },
    },
  };
}

describe("rate-limit routing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses only the upload limiter for presigned upload requests", async () => {
    const ctx = createContext({ ai: true, image: true, upload: true });

    await enforceRateLimit(ctx as never, "upload_presign");

    expect(ctx.env.UPLOAD_RATE_LIMITER?.limit).toHaveBeenCalledWith({
      key: "user:user-1",
    });
    expect(ctx.env.AI_RATE_LIMITER?.limit).not.toHaveBeenCalled();
    expect(ctx.env.IMAGE_AI_RATE_LIMITER?.limit).not.toHaveBeenCalled();
  });

  it("uses the shared AI limit for non-image AI work", async () => {
    const ctx = createContext({ ai: true, image: true, upload: true });

    await enforceRateLimit(ctx as never, "recipe_chat");

    expect(ctx.env.AI_RATE_LIMITER?.limit).toHaveBeenCalledTimes(1);
    expect(ctx.env.IMAGE_AI_RATE_LIMITER?.limit).not.toHaveBeenCalled();
  });

  it("requires both shared and image capacity for image work", async () => {
    const ctx = createContext({ ai: true, image: true });

    await enforceRateLimit(ctx as never, "recipe_generate_image");

    expect(ctx.env.AI_RATE_LIMITER?.limit).toHaveBeenCalledTimes(1);
    expect(ctx.env.IMAGE_AI_RATE_LIMITER?.limit).toHaveBeenCalledTimes(1);
  });

  it("returns a stable public error and stops after the first denied limit", async () => {
    const ctx = createContext({ ai: false, image: true });

    await expect(
      enforceRateLimit(ctx as never, "recipe_parse_image"),
    ).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
      appCode: "RATE_LIMITED",
    });
    expect(ctx.env.IMAGE_AI_RATE_LIMITER?.limit).not.toHaveBeenCalled();
  });

  it("is a no-op when the optional binding is not configured", async () => {
    await expect(
      enforceRateLimit(createContext({}) as never, "recipe_chat"),
    ).resolves.toBeUndefined();
  });
});
