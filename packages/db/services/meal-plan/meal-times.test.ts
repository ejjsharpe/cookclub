import { describe, expect, it } from "vitest";

import {
  DEFAULT_MEAL_TIMES,
  createMealTime,
  type MealTime,
  resolveMealTimes,
  applyMealTimeChange,
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

describe("applyMealTimeChange", () => {
  const current: MealTime[] = [
    ...DEFAULT_MEAL_TIMES,
    { key: "snack", name: "Snack", addedBy: me },
  ];
  const keys = (list: MealTime[]) => list.map((t) => t.key);

  it("hides and shows one meal time, leaving the rest as they are", () => {
    const hidden = applyMealTimeChange(
      current,
      { type: "hide", key: "breakfast" },
      false,
    );
    expect(hidden[0]!.hidden).toBe(true);
    expect(hidden[3]).toEqual(current[3]);

    const shown = applyMealTimeChange(
      hidden,
      { type: "show", key: "breakfast" },
      false,
    );
    expect(shown[0]).toEqual(DEFAULT_MEAL_TIMES[0]);
  });

  it("moves a meal time before another, or to the end", () => {
    expect(
      keys(
        applyMealTimeChange(
          current,
          { type: "move", key: "snack", beforeKey: "dinner" },
          false,
        ),
      ),
    ).toEqual(["breakfast", "lunch", "snack", "dinner"]);
    expect(
      keys(
        applyMealTimeChange(
          current,
          { type: "move", key: "breakfast", beforeKey: null },
          false,
        ),
      ),
    ).toEqual(["lunch", "dinner", "snack", "breakfast"]);
  });

  it("moves to the end if the meal time it was dropped before has gone", () => {
    expect(
      keys(
        applyMealTimeChange(
          current,
          { type: "move", key: "lunch", beforeKey: "supper" },
          false,
        ),
      ),
    ).toEqual(["breakfast", "dinner", "snack", "lunch"]);
  });

  it("only touches the named meal time, so an out-of-date list can't drop others", () => {
    // Someone else added Supper; this phone's list predates it.
    const withSupper = [...current, { key: "supper", name: "Supper" }];
    const next = applyMealTimeChange(
      withSupper,
      { type: "hide", key: "lunch" },
      false,
    );
    expect(keys(next)).toContain("supper");
  });

  it("removes an unused custom meal time", () => {
    expect(
      keys(
        applyMealTimeChange(current, { type: "remove", key: "snack" }, false),
      ),
    ).toEqual(["breakfast", "lunch", "dinner"]);
  });

  it("won't remove a default, one with meals planned, or one already gone", () => {
    expect(() =>
      applyMealTimeChange(current, { type: "remove", key: "lunch" }, false),
    ).toThrow(/hidden but not deleted/);
    expect(() =>
      applyMealTimeChange(current, { type: "remove", key: "snack" }, true),
    ).toThrow(/still has meals planned/);
    expect(() =>
      applyMealTimeChange(current, { type: "hide", key: "brunch" }, false),
    ).toThrow(/removed from this plan/);
  });

  it("keeps at least one meal time on", () => {
    const onlyDinner = current.map((t) =>
      t.key === "dinner" ? t : { ...t, hidden: true },
    );
    expect(() =>
      applyMealTimeChange(onlyDinner, { type: "hide", key: "dinner" }, false),
    ).toThrow(/at least one/);
  });
});
