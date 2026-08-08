import { describe, expect, it } from "vitest";

import { generatePresignedUploadUrl, validateKey } from "./presign";
import type { Env } from "./types";

describe("generatePresignedUploadUrl", () => {
  it("does not sign Content-Type because native clients may normalize it", async () => {
    const result = await generatePresignedUploadUrl(
      {
        PUBLIC_URL: "https://images.example.com",
        R2_ACCESS_KEY_ID: "test-access-key",
        R2_SECRET_ACCESS_KEY: "test-secret-key",
        R2_S3_API_URL: "https://account.r2.cloudflarestorage.com/test-bucket",
      } as Env,
      {
        key: "temp/user/image.jpg",
        contentType: "image/jpeg",
      },
    );

    const uploadUrl = new URL(result.uploadUrl);

    expect(uploadUrl.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
  });
});

describe("validateKey", () => {
  it("accepts job-scoped import image keys", () => {
    expect(validateKey("imports/url-123/image-id.jpg")).toBe(true);
  });

  it("rejects traversal in job-scoped import image keys", () => {
    expect(validateKey("imports/url-123/../image-id.jpg")).toBe(false);
  });
});
