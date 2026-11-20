import type { MealTime } from "../../schemas/meal-plan-schema";
import { ServiceError } from "../errors";

export type { MealTime };

// Every plan starts with these, in this order. They can be hidden but not deleted.
export const DEFAULT_MEAL_TIMES: readonly MealTime[] = [
  { key: "breakfast", name: "Breakfast" },
  { key: "lunch", name: "Lunch" },
  { key: "dinner", name: "Dinner" },
];

const DEFAULT_KEYS = new Set(DEFAULT_MEAL_TIMES.map((t) => t.key));

export const MAX_MEAL_TIMES = 12;
export const MAX_MEAL_TIME_NAME_LENGTH = 24;

/** A plan's meal times, falling back to the defaults when it has none saved. */
export function resolveMealTimes(stored: MealTime[] | null | undefined) {
  return stored && stored.length > 0 ? stored : [...DEFAULT_MEAL_TIMES];
}

export function isDefaultMealTime(key: string) {
  return DEFAULT_KEYS.has(key);
}

function cleanName(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

/**
 * Builds the meal time for a new name, with a key unique within the plan.
 * Throws when the name is empty, too long or already used.
 */
export function createMealTime(
  existing: readonly MealTime[],
  name: string,
  addedBy: { id: string; name: string },
): MealTime {
  const clean = cleanName(name);
  if (!clean) {
    throw new ServiceError("BAD_REQUEST", "Give the meal time a name");
  }
  if (clean.length > MAX_MEAL_TIME_NAME_LENGTH) {
    throw new ServiceError(
      "BAD_REQUEST",
      `Meal time names can be up to ${MAX_MEAL_TIME_NAME_LENGTH} characters`,
    );
  }
  if (existing.length >= MAX_MEAL_TIMES) {
    throw new ServiceError(
      "BAD_REQUEST",
      `A plan can have up to ${MAX_MEAL_TIMES} meal times`,
    );
  }
  const lower = clean.toLowerCase();
  if (existing.some((t) => t.name.toLowerCase() === lower)) {
    throw new ServiceError("CONFLICT", `There's already a ${clean} meal time`);
  }

  const base =
    lower
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "meal";
  const keys = new Set(existing.map((t) => t.key));
  let key = base;
  for (let n = 2; keys.has(key); n++) key = `${base}-${n}`;

  return { key, name: clean, addedBy };
}

/**
 * One edit to a plan's meal times. Edits name a single meal time rather than
 * sending the whole list, so a phone with an out-of-date list can't undo or
 * delete changes other people on the plan have made since.
 */
export type MealTimeChange =
  | { type: "hide"; key: string }
  | { type: "show"; key: string }
  // Place `key` just before `beforeKey`, or at the end when it's null.
  | { type: "move"; key: string; beforeKey: string | null }
  | { type: "remove"; key: string };

/**
 * Applies one change to the current meal times and returns the new list.
 * `hasMeals` says whether the changed meal time still has meals planned;
 * it's only consulted for removals, which it blocks.
 */
export function applyMealTimeChange(
  current: readonly MealTime[],
  change: MealTimeChange,
  hasMeals: boolean,
): MealTime[] {
  const index = current.findIndex((t) => t.key === change.key);
  const target = current[index];
  if (!target) {
    throw new ServiceError(
      "NOT_FOUND",
      "That meal time has been removed from this plan",
    );
  }

  switch (change.type) {
    case "show": {
      const { hidden: _hidden, ...shown } = target;
      return current.map((t, i) => (i === index ? shown : t));
    }
    case "hide": {
      if (current.every((t) => t.key === target.key || t.hidden)) {
        throw new ServiceError("BAD_REQUEST", "Keep at least one meal time on");
      }
      return current.map((t, i) => (i === index ? { ...t, hidden: true } : t));
    }
    case "move": {
      if (change.beforeKey === target.key) return [...current];
      const rest = current.filter((t) => t.key !== target.key);
      // If the meal time it was dropped before has since gone, it goes last.
      const at = change.beforeKey
        ? rest.findIndex((t) => t.key === change.beforeKey)
        : -1;
      rest.splice(at === -1 ? rest.length : at, 0, target);
      return rest;
    }
    case "remove": {
      if (isDefaultMealTime(target.key)) {
        throw new ServiceError(
          "BAD_REQUEST",
          `${target.name} can be hidden but not deleted`,
        );
      }
      if (hasMeals) {
        throw new ServiceError(
          "BAD_REQUEST",
          `${target.name} still has meals planned. Hide it instead, or remove those meals first.`,
        );
      }
      return current.filter((t) => t.key !== target.key);
    }
  }
}
