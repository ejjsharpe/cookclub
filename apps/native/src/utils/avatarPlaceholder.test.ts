import { describe, expect, it } from "vitest";

import { getInitials, getPlaceholderColours } from "./avatarPlaceholder";

describe("getInitials", () => {
  it("uses first and last name", () => {
    expect(getInitials("Priya Shah")).toBe("PS");
    expect(getInitials("Mary Jane Watson")).toBe("MW");
  });
  it("handles single names and blanks", () => {
    expect(getInitials("james")).toBe("J");
    expect(getInitials("  ")).toBe("?");
  });
});

describe("getPlaceholderColours", () => {
  it("is stable for a name", () => {
    expect(getPlaceholderColours("Tom Okafor")).toEqual(
      getPlaceholderColours("Tom Okafor"),
    );
  });
});
