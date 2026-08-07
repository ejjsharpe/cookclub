import { describe, expect, it } from "vitest";

import { formatRelativeTimeShort } from "./relativeTime";

const NOW = new Date("2026-08-07T12:00:00.000Z");

describe("formatRelativeTimeShort", () => {
  it.each([
    ["2026-08-07T11:59:45.000Z", "now"],
    ["2026-08-07T11:52:00.000Z", "8m"],
    ["2026-08-07T08:00:00.000Z", "4h"],
    ["2026-08-05T12:00:00.000Z", "2d"],
    ["2026-07-17T12:00:00.000Z", "3w"],
    ["2024-08-07T12:00:00.000Z", "2y"],
  ])("formats %s as %s", (value, expected) => {
    expect(formatRelativeTimeShort(value, NOW)).toBe(expected);
  });

  it("treats a future timestamp as now", () => {
    expect(formatRelativeTimeShort("2026-08-08T12:00:00.000Z", NOW)).toBe(
      "now",
    );
  });
});
