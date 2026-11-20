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
 * Checks an edited list (reordered, hidden, renamed or with some removed)
 * against the current one. New meal times go through createMealTime instead.
 * `usedKeys` are meal times that still have meals planned; they can't be removed.
 */
export function validateMealTimesUpdate(
  current: readonly MealTime[],
  next: readonly { key: string; name: string; hidden?: boolean }[],
  usedKeys: ReadonlySet<string>,
): MealTime[] {
  const byKey = new Map(current.map((t) => [t.key, t]));
  const seen = new Set<string>();
  const names = new Set<string>();
  const result: MealTime[] = [];

  for (const item of next) {
    const existing = byKey.get(item.key);
    if (!existing) {
      throw new ServiceError("BAD_REQUEST", "Unknown meal time");
    }
    if (seen.has(item.key)) {
      throw new ServiceError("BAD_REQUEST", "Meal times must be unique");
    }
    seen.add(item.key);

    const name = cleanName(item.name);
    if (!name || name.length > MAX_MEAL_TIME_NAME_LENGTH) {
      throw new ServiceError("BAD_REQUEST", "Invalid meal time name");
    }
    if (names.has(name.toLowerCase())) {
      throw new ServiceError("CONFLICT", `There's already a ${name} meal time`);
    }
    names.add(name.toLowerCase());

    const { hidden: _hidden, ...rest } = existing;
    result.push(
      item.hidden ? { ...rest, name, hidden: true } : { ...rest, name },
    );
  }

  for (const t of current) {
    if (seen.has(t.key)) continue;
    if (isDefaultMealTime(t.key)) {
      throw new ServiceError(
        "BAD_REQUEST",
        `${t.name} can be hidden but not deleted`,
      );
    }
    if (usedKeys.has(t.key)) {
      throw new ServiceError(
        "BAD_REQUEST",
        `${t.name} still has meals planned. Hide it instead, or remove those meals first.`,
      );
    }
  }

  if (!result.some((t) => !t.hidden)) {
    throw new ServiceError("BAD_REQUEST", "Keep at least one meal time on");
  }

  return result;
}
