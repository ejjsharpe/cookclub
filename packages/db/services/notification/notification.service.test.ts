import { describe, expect, it } from "vitest";

import { formatCommentPreview } from "./notification.service";

describe("formatCommentPreview", () => {
  it("keeps short previews intact", () => {
    expect(formatCommentPreview("This looks delicious!")).toBe(
      "This looks delicious!",
    );
  });

  it("truncates normalized preview sources to 120 characters", () => {
    const preview = formatCommentPreview("x".repeat(121));

    expect(preview).toHaveLength(120);
    expect(preview?.endsWith("…")).toBe(true);
  });

  it("does not split emoji at the truncation boundary", () => {
    const preview = formatCommentPreview(`${"x".repeat(118)}🍲🍲🍲`);

    expect(preview).toBe(`${"x".repeat(118)}🍲…`);
  });

  it("keeps absent previews absent", () => {
    expect(formatCommentPreview(null)).toBeNull();
  });
});
