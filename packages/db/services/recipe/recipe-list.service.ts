import type { PublicImageAsset } from "@repo/contracts/images";
import { and, desc, eq, exists, ilike, inArray, lt, lte } from "drizzle-orm";

import { recipeImages, recipes, recipeTags, tags, user } from "../../schemas";
import { ServiceError } from "../errors";
import type { DbClient } from "../types";
import {
  decodeRecipeKeysetCursor,
  encodeRecipeKeysetCursor,
  recipeKeysetAfter,
  recipeKeysetCursorFor,
  recipeKeysetOrder,
  recipeNameSortKey,
  recipeSourceCondition,
  type RecipeKeysetSort,
  type RecipeSourceFilter,
} from "./recipe-sort";

const MAX_RECIPE_LIST_LIMIT = 100;

type PublicRecipeTag = Pick<typeof tags.$inferSelect, "id" | "name">;

export interface RecipeListRow {
  recipe: typeof recipes.$inferSelect;
  uploader: {
    id: string;
    name: string;
    username: string | null;
    image: string | null;
  };
}

export interface RecipeListRelations {
  tagsByRecipe: Map<number, PublicRecipeTag[]>;
  coverImageByRecipe: Map<number, PublicImageAsset>;
}

export function normalizeRecipeListLimit(limit = 20): number {
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_RECIPE_LIST_LIMIT);
}

function toPublicImageAsset(row: {
  url: string;
  storageKey: string;
  width: number;
  height: number;
  contentType: string;
  byteSize: number;
  thumbhash: string;
}): PublicImageAsset {
  return {
    ...row,
    contentType: row.contentType as PublicImageAsset["contentType"],
  };
}

export async function loadRecipeListRelations(
  db: DbClient,
  recipeIds: number[],
): Promise<RecipeListRelations> {
  const tagsByRecipe = new Map<number, PublicRecipeTag[]>();
  const coverImageByRecipe = new Map<number, PublicImageAsset>();
  if (recipeIds.length === 0) return { tagsByRecipe, coverImageByRecipe };

  const [tagRows, imageRows] = await Promise.all([
    db
      .select({
        recipeId: recipeTags.recipeId,
        tag: { id: tags.id, name: tags.name },
      })
      .from(recipeTags)
      .innerJoin(tags, eq(recipeTags.tagId, tags.id))
      .where(inArray(recipeTags.recipeId, recipeIds)),
    db
      .select({
        recipeId: recipeImages.recipeId,
        url: recipeImages.url,
        storageKey: recipeImages.storageKey,
        width: recipeImages.width,
        height: recipeImages.height,
        contentType: recipeImages.contentType,
        byteSize: recipeImages.byteSize,
        thumbhash: recipeImages.thumbhash,
      })
      .from(recipeImages)
      .where(inArray(recipeImages.recipeId, recipeIds))
      .orderBy(recipeImages.recipeId, recipeImages.index),
  ]);

  for (const row of tagRows) {
    const recipeTagsForRow = tagsByRecipe.get(row.recipeId) ?? [];
    if (row.tag) recipeTagsForRow.push(row.tag);
    tagsByRecipe.set(row.recipeId, recipeTagsForRow);
  }

  for (const row of imageRows) {
    if (!coverImageByRecipe.has(row.recipeId)) {
      coverImageByRecipe.set(row.recipeId, toPublicImageAsset(row));
    }
  }

  return { tagsByRecipe, coverImageByRecipe };
}

export async function hydrateRecipeListRows<T extends RecipeListRow>(
  db: DbClient,
  rows: T[],
) {
  const relations = await loadRecipeListRelations(
    db,
    rows.map((row) => row.recipe.id),
  );

  return rows.map((row) => ({
    ...row.recipe,
    coverImage: relations.coverImageByRecipe.get(row.recipe.id) ?? null,
    owner: row.uploader,
    tags: relations.tagsByRecipe.get(row.recipe.id) ?? [],
  }));
}

function nextRecipeListCursor(
  hasMore: boolean,
  rows: RecipeListRow[],
): number | undefined {
  return hasMore ? rows.at(-1)?.recipe.createdAt.getTime() : undefined;
}

export async function queryUserRecipes(
  db: DbClient,
  options: {
    ownerId: string;
    /** Newest first by default; keyset sorts page with a string cursor. */
    sort?: "recent" | RecipeKeysetSort;
    /** `createdAt` in ms for the newest-first order, else an opaque string. */
    cursor?: number | string;
    tagIds?: number[];
    maxTotalTime?: number;
    source?: RecipeSourceFilter;
    limit?: number;
  },
) {
  const limit = normalizeRecipeListLimit(options.limit);
  const keysetSort = options.sort === "recent" ? undefined : options.sort;
  if (
    options.cursor !== undefined &&
    typeof options.cursor !== (keysetSort ? "string" : "number")
  ) {
    throw new ServiceError(
      "BAD_REQUEST",
      "Recipe list cursor does not match this sort.",
    );
  }
  const keysetCursor =
    keysetSort && typeof options.cursor === "string"
      ? decodeRecipeKeysetCursor(options.cursor, keysetSort)
      : undefined;
  const recentCursor =
    typeof options.cursor === "number" ? options.cursor : undefined;
  const tagIds = [...new Set(options.tagIds ?? [])].filter((id) => id > 0);
  const tagFilter =
    tagIds.length === 0
      ? undefined
      : exists(
          db
            .select({ id: recipeTags.id })
            .from(recipeTags)
            .innerJoin(tags, eq(recipeTags.tagId, tags.id))
            .where(
              and(
                eq(recipeTags.recipeId, recipes.id),
                inArray(recipeTags.tagId, tagIds),
                eq(tags.userId, options.ownerId),
              ),
            ),
        );
  const maxTotalTime =
    options.maxTotalTime !== undefined && Number.isFinite(options.maxTotalTime)
      ? Math.max(0, Math.trunc(options.maxTotalTime))
      : undefined;

  const rows = await db
    .select({
      recipe: recipes,
      uploader: {
        id: user.id,
        name: user.name,
        username: user.username,
        image: user.image,
      },
      nameKey: recipeNameSortKey,
    })
    .from(recipes)
    .innerJoin(user, eq(recipes.ownerId, user.id))
    .where(
      and(
        eq(recipes.ownerId, options.ownerId),
        eq(recipes.moderationState, "visible"),
        recentCursor !== undefined
          ? lt(recipes.createdAt, new Date(recentCursor))
          : undefined,
        keysetCursor ? recipeKeysetAfter(keysetCursor) : undefined,
        maxTotalTime === undefined
          ? undefined
          : lte(recipes.totalTime, maxTotalTime),
        recipeSourceCondition(options.source),
        tagFilter,
      ),
    )
    .orderBy(
      ...(keysetSort
        ? recipeKeysetOrder(keysetSort)
        : [desc(recipes.createdAt), desc(recipes.id)]),
    )
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const lastRow = pageRows.at(-1);
  return {
    items: await hydrateRecipeListRows(db, pageRows),
    nextCursor: keysetSort
      ? hasMore && lastRow
        ? encodeRecipeKeysetCursor(recipeKeysetCursorFor(keysetSort, lastRow))
        : undefined
      : nextRecipeListCursor(hasMore, pageRows),
  };
}

export async function queryUserRecipesByOwner(
  db: DbClient,
  options: {
    ownerId: string;
    cursor?: number;
    search?: string;
    limit?: number;
  },
) {
  const limit = normalizeRecipeListLimit(options.limit);
  const search = options.search?.trim() || undefined;
  const rows = await db
    .select({
      recipe: recipes,
      uploader: {
        id: user.id,
        name: user.name,
        username: user.username,
        image: user.image,
      },
    })
    .from(recipes)
    .innerJoin(user, eq(recipes.ownerId, user.id))
    .where(
      and(
        eq(recipes.ownerId, options.ownerId),
        eq(recipes.moderationState, "visible"),
        options.cursor !== undefined
          ? lt(recipes.createdAt, new Date(options.cursor))
          : undefined,
        search ? ilike(recipes.name, `%${search}%`) : undefined,
      ),
    )
    .orderBy(desc(recipes.createdAt), desc(recipes.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  return {
    items: await hydrateRecipeListRows(db, pageRows),
    nextCursor: nextRecipeListCursor(hasMore, pageRows),
  };
}
