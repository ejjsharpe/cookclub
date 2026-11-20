import { and, asc, eq, gt, notInArray, or, sql, type SQL } from "drizzle-orm";

import { recipes } from "../../schemas";
import { ServiceError } from "../errors";

/** Orders a library list can use besides its default (newest or best match). */
export const RECIPE_KEYSET_SORTS = ["name", "time"] as const;
export type RecipeKeysetSort = (typeof RECIPE_KEYSET_SORTS)[number];

/** Where a recipe in the library came from. */
export const RECIPE_SOURCE_FILTERS = ["mine", "web", "cook"] as const;
export type RecipeSourceFilter = (typeof RECIPE_SOURCE_FILTERS)[number];

export function isRecipeKeysetSort(value: unknown): value is RecipeKeysetSort {
  return RECIPE_KEYSET_SORTS.includes(value as RecipeKeysetSort);
}

/**
 * "web" is a recipe imported from a link, "cook" one saved from another
 * user, and "mine" everything the user made themselves (typed, scanned,
 * pasted or generated).
 */
export function recipeSourceCondition(
  source: RecipeSourceFilter | undefined,
): SQL | undefined {
  switch (source) {
    case "web":
      return eq(recipes.sourceType, "url");
    case "cook":
      return eq(recipes.sourceType, "user");
    case "mine":
      return notInArray(recipes.sourceType, ["url", "user"]);
    default:
      return undefined;
  }
}

export type RecipeKeysetCursor =
  | { v: 1; sort: "name"; key: string; id: number; f?: string }
  | { v: 1; sort: "time"; key: number | null; id: number; f?: string };

/** The name as the database compares it; select it to build a cursor. */
export const recipeNameSortKey = sql<string>`lower(${recipes.name})`;
const nameKey = recipeNameSortKey;

/** A-Z by name, or shortest total time first with unknown times last. */
export function recipeKeysetOrder(sort: RecipeKeysetSort): SQL[] {
  return sort === "name"
    ? [asc(nameKey), asc(recipes.id)]
    : [sql`${recipes.totalTime} asc nulls last`, asc(recipes.id)];
}

/** Rows strictly after the cursor in {@link recipeKeysetOrder}. */
export function recipeKeysetAfter(cursor: RecipeKeysetCursor): SQL {
  if (cursor.sort === "name") {
    return sql`(${nameKey}, ${recipes.id}) > (${cursor.key}, ${cursor.id})`;
  }

  if (cursor.key === null) {
    return and(sql`${recipes.totalTime} IS NULL`, gt(recipes.id, cursor.id))!;
  }

  return or(
    gt(recipes.totalTime, cursor.key),
    and(eq(recipes.totalTime, cursor.key), gt(recipes.id, cursor.id)),
    sql`${recipes.totalTime} IS NULL`,
  )!;
}

export function recipeKeysetCursorFor(
  sort: RecipeKeysetSort,
  row: { recipe: { id: number; totalTime: number | null }; nameKey: string },
  fingerprint?: string,
): RecipeKeysetCursor {
  const { recipe } = row;
  const base = fingerprint ? { f: fingerprint } : {};
  return sort === "name"
    ? { v: 1, sort, key: row.nameKey, id: recipe.id, ...base }
    : { v: 1, sort, key: recipe.totalTime, id: recipe.id, ...base };
}

function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid base64url");
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return new TextDecoder("utf-8", { fatal: true }).decode(
    Uint8Array.from(binary, (character) => character.charCodeAt(0)),
  );
}

export function encodeRecipeKeysetCursor(cursor: RecipeKeysetCursor): string {
  return toBase64Url(JSON.stringify(cursor));
}

export function decodeRecipeKeysetCursor(
  value: string,
  sort: RecipeKeysetSort,
): RecipeKeysetCursor {
  try {
    const cursor = JSON.parse(fromBase64Url(value)) as Partial<
      RecipeKeysetCursor & { key: unknown }
    >;
    const validKey =
      sort === "name"
        ? typeof cursor.key === "string"
        : cursor.key === null ||
          (typeof cursor.key === "number" && Number.isFinite(cursor.key));

    if (
      cursor.v !== 1 ||
      cursor.sort !== sort ||
      !validKey ||
      !Number.isInteger(cursor.id) ||
      (cursor.id as number) <= 0 ||
      (cursor.f !== undefined && typeof cursor.f !== "string")
    ) {
      throw new Error("Invalid cursor payload");
    }

    return cursor as RecipeKeysetCursor;
  } catch (cause) {
    throw new ServiceError("BAD_REQUEST", "Invalid recipe list cursor", {
      cause,
    });
  }
}
