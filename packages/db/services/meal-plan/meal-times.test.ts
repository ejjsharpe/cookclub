import { describe, expect, it } from "vitest";

import {
  DEFAULT_MEAL_TIMES,
  createMealTime,
  resolveMealTimes,
  validateMealTimesUpdate,
} from "./meal-times";

const me = { id: "u1", name: "Elliot" };

describe("resolveMealTimes", () => {
  it("falls back to breakfast, lunch and dinner", () => {
    expect(resolveMealTimes(null).map((t) => t.key)).toEqual([
      "breakfast",
      "lunch",
      "dinner",
    ]);
    expect(resolveMealTimes([])).toHaveLength(3);
  });

  it("keeps a saved list as it is", () => {
    const saved = [...DEFAULT_MEAL_TIMES, { key: "supper", name: "Supper" }];
    expect(resolveMealTimes(saved)).toBe(saved);
  });
});

describe("createMealTime", () => {
  it("makes a key from the name and records who added it", () => {
    expect(createMealTime(DEFAULT_MEAL_TIMES, "  Late   snack ", me)).toEqual({
      key: "late-snack",
      name: "Late snack",
      addedBy: me,
    });
  });

  it("rejects empty, duplicate and over-long names", () => {
    expect(() => createMealTime(DEFAULT_MEAL_TIMES, "   ", me)).toThrow();
    expect(() => createMealTime(DEFAULT_MEAL_TIMES, "lunch", me)).toThrow(
      /already a lunch/,
    );
    expect(() =>
      createMealTime(DEFAULT_MEAL_TIMES, "x".repeat(25), me),
    ).toThrow();
  });

  it("keeps keys unique when a renamed meal time already uses one", () => {
    const existing = [
      ...DEFAULT_MEAL_TIMES,
      { key: "supper", name: "Late dinner" },
    ];
    expect(createMealTime(existing, "Supper", me).key).toBe("supper-2");
  });

  it("falls back to a generic key for names without letters or numbers", () => {
    expect(createMealTime(DEFAULT_MEAL_TIMES, "🍰", me).key).toBe("meal");
  });
});

describe("validateMealTimesUpdate", () => {
  const current = [
    ...DEFAULT_MEAL_TIMES,
    { key: "snack", name: "Snack", addedBy: me },
  ];

  it("reorders and hides, keeping who added each one", () => {
    const next = validateMealTimesUpdate(
      current,
      [
        { key: "breakfast", name: "Breakfast", hidden: true },
        { key: "snack", name: "Snack" },
        { key: "lunch", name: "Lunch" },
        { key: "dinner", name: "Dinner" },
      ],
      new Set(),
    );
    expect(next.map((t) => t.key)).toEqual([
      "breakfast",
      "snack",
      "lunch",
      "dinner",
    ]);
    expect(next[0]!.hidden).toBe(true);
    expect(next[1]!.addedBy).toEqual(me);
  });

  it("removes an unused custom meal time", () => {
    const next = validateMealTimesUpdate(
      current,
      DEFAULT_MEAL_TIMES,
      new Set(),
    );
    expect(next.map((t) => t.key)).toEqual(["breakfast", "lunch", "dinner"]);
  });

  it("won't remove a default or one with meals planned", () => {
    expect(() =>
      validateMealTimesUpdate(current, current.slice(1), new Set()),
    ).toThrow(/hidden but not deleted/);
    expect(() =>
      validateMealTimesUpdate(current, DEFAULT_MEAL_TIMES, new Set(["snack"])),
    ).toThrow(/still has meals planned/);
  });

  it("rejects unknown keys, duplicates and hiding everything", () => {
    expect(() =>
      validateMealTimesUpdate(
        current,
        [...current, { key: "brunch", name: "Brunch" }],
        new Set(),
      ),
    ).toThrow(/Unknown/);
    expect(() =>
      validateMealTimesUpdate(current, [...current, current[0]!], new Set()),
    ).toThrow(/unique/);
    expect(() =>
      validateMealTimesUpdate(
        current,
        current.map((t) => ({ ...t, hidden: true })),
        new Set(),
      ),
    ).toThrow(/at least one/);
  });
});
