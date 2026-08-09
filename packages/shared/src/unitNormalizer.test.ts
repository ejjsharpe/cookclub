import { describe, expect, it } from "vitest";

import {
  getCanonicalUnits,
  getUnitVariations,
  isRecognizedUnit,
  normalizeUnit,
} from "./unitNormalizer";

describe("unit normalization", () => {
  it.each([
    [" cups ", "cup"],
    ["ML", "milliliter"],
    ["T", "tablespoon"],
    ["t", "teaspoon"],
    ["scoops", "scoops"],
    [null, null],
  ] as const)("normalizes %s to %s", (input, expected) => {
    expect(normalizeUnit(input)).toBe(expected);
  });

  it("recognizes case-sensitive single-letter units", () => {
    expect(isRecognizedUnit("T")).toBe(true);
    expect(isRecognizedUnit("t")).toBe(true);
  });

  it.each(["tbsp", " Tablespoons ", "KG"])("recognizes %s", (unit) => {
    expect(isRecognizedUnit(unit)).toBe(true);
  });

  it.each([null, "", "scoop"])("rejects unknown unit %s", (unit) => {
    expect(isRecognizedUnit(unit)).toBe(false);
  });

  it("exposes canonical units and safe empty variations", () => {
    expect(getCanonicalUnits()).toEqual(
      expect.arrayContaining(["cup", "tablespoon", "gram"]),
    );
    expect(getUnitVariations("teaspoon")).toContain("tsp");
    expect(getUnitVariations("unknown")).toEqual([]);
  });
});
