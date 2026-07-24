import { describe, expect, it } from "vitest";

import { validateKey } from "./presign";

describe("validateKey", () => {
  it("accepts job-scoped import image keys", () => {
    expect(validateKey("imports/url-123/image-id.jpg")).toBe(true);
  });

  it("rejects traversal in job-scoped import image keys", () => {
    expect(validateKey("imports/url-123/../image-id.jpg")).toBe(false);
  });
});
