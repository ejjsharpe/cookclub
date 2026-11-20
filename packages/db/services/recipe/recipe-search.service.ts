import { and, desc, eq, lte, or, sql } from "drizzle-orm";

import { recipes, recipeSearchDocuments, user } from "../../schemas";
import { ServiceError } from "../errors";
import type { DbClient } from "../types";
import { hydrateRecipeListRows } from "./recipe-list.service";
import {
  MAX_RECIPE_SEARCH_LEXEMES,
  normalizeRecipeSearchInput,
  normalizeRecipeTitleForSearch,
} from "./recipe-search-input";
import {
  decodeRecipeKeysetCursor,
  encodeRecipeKeysetCursor,
  isRecipeKeysetSort,
  recipeKeysetAfter,
  recipeKeysetCursorFor,
  recipeKeysetOrder,
  recipeNameSortKey,
  recipeSourceCondition,
  type RecipeKeysetCursor,
  type RecipeKeysetSort,
  type RecipeSourceFilter,
} from "./recipe-sort";

export interface SearchCursorPayload {
  v: 1;
  fingerprint: string;
  exactTitle: boolean;
  titleMatch: boolean;
  rank: number;
  createdAt: string;
  recipeId: number;
}

export interface SearchUserRecipesOptions {
  ownerId: string;
  query: string;
  /** Best match by default. */
  sort?: "relevance" | RecipeKeysetSort;
  source?: RecipeSourceFilter;
  tagIds?: number[];
  maxTotalTime?: number;
  limit?: number;
  cursor?: string;
}

export interface RecipeSearchQueryOptions {
  ownerId: string;
  query: string;
  ingredientQuery: string;
  tagIds: number[];
  maxTotalTime: number | null;
  limit: number;
  cursor: SearchCursorPayload | null;
  sort?: RecipeKeysetSort | undefined;
  source?: RecipeSourceFilter | undefined;
  keysetCursor?: RecipeKeysetCursor | null;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Invalid base64url");
  }
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function searchFingerprint(input: {
  query: string;
  tagIds: number[];
  maxTotalTime: number | null;
  sort?: RecipeKeysetSort | undefined;
  source?: RecipeSourceFilter | undefined;
}): Promise<string> {
  // Optional keys are left out when unset so best-match cursors issued before
  // sort and source existed keep their fingerprint.
  const canonical = JSON.stringify({
    query: normalizeRecipeTitleForSearch(input.query),
    tagIds: input.tagIds,
    maxTotalTime: input.maxTotalTime,
    sort: input.sort,
    source: input.source,
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

export function encodeRecipeSearchCursor(payload: SearchCursorPayload): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

export function decodeRecipeSearchCursor(cursor: string): SearchCursorPayload {
  try {
    const value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
        base64UrlToBytes(cursor),
      ),
    ) as Partial<SearchCursorPayload>;
    const createdAt = new Date(value.createdAt ?? "");

    if (
      value.v !== 1 ||
      typeof value.fingerprint !== "string" ||
      typeof value.exactTitle !== "boolean" ||
      typeof value.titleMatch !== "boolean" ||
      typeof value.rank !== "number" ||
      !Number.isFinite(value.rank) ||
      !Number.isInteger(value.recipeId) ||
      value.recipeId! <= 0 ||
      Number.isNaN(createdAt.getTime())
    ) {
      throw new Error("Invalid cursor payload");
    }

    return value as SearchCursorPayload;
  } catch (cause) {
    throw new ServiceError("BAD_REQUEST", "Invalid recipe search cursor", {
      cause,
    });
  }
}

export function buildRecipeSearchQuery(
  db: DbClient,
  options: RecipeSearchQueryOptions,
) {
  const rawTsQuery = sql`recipe_prefix_tsquery(${options.query})`;
  const ingredientTsQuery = sql`recipe_prefix_tsquery(${options.ingredientQuery})`;
  const exactTitle = sql<boolean>`recipe_normalize_search_text(${recipeSearchDocuments.title}) = recipe_normalize_search_text(${options.query})`;
  const titleMatch = sql<boolean>`${recipeSearchDocuments.titleVector} @@ ${rawTsQuery}`;
  const relevanceRank = sql<number>`GREATEST(
    ts_rank_cd(${recipeSearchDocuments.combinedVector}, ${rawTsQuery}),
    ts_rank_cd(${recipeSearchDocuments.ingredientVector}, ${ingredientTsQuery})
  )`;

  const tagFilter =
    options.tagIds.length === 0
      ? undefined
      : sql`EXISTS (
          SELECT 1
          FROM recipe_tags AS matching_recipe_tag
          INNER JOIN tags AS matching_tag
            ON matching_tag.id = matching_recipe_tag.tag_id
          WHERE matching_recipe_tag.recipe_id = ${recipes.id}
            AND matching_recipe_tag.tag_id IN (${sql.join(
              options.tagIds.map((tagId) => sql`${tagId}`),
              sql`, `,
            )})
            AND matching_tag.user_id = ${options.ownerId}
        )`;

  const relevanceCursorFilter = options.cursor
    ? sql`(
        ${exactTitle},
        ${titleMatch},
        ${relevanceRank},
        ${recipes.createdAt},
        ${recipes.id}
      ) < (
        ${options.cursor.exactTitle},
        ${options.cursor.titleMatch},
        ${options.cursor.rank}::real,
        ${new Date(options.cursor.createdAt)},
        ${options.cursor.recipeId}
      )`
    : undefined;
  const cursorFilter = options.sort
    ? options.keysetCursor
      ? recipeKeysetAfter(options.keysetCursor)
      : undefined
    : relevanceCursorFilter;

  return db
    .select({
      recipe: recipes,
      uploader: {
        id: user.id,
        name: user.name,
        username: user.username,
        image: user.image,
      },
      exactTitle,
      titleMatch,
      relevanceRank,
      nameKey: recipeNameSortKey,
    })
    .from(recipeSearchDocuments)
    .innerJoin(recipes, eq(recipeSearchDocuments.recipeId, recipes.id))
    .innerJoin(user, eq(recipes.ownerId, user.id))
    .where(
      and(
        eq(recipeSearchDocuments.ownerId, options.ownerId),
        eq(recipes.ownerId, options.ownerId),
        or(
          sql`${recipeSearchDocuments.combinedVector} @@ ${rawTsQuery}`,
          sql`${recipeSearchDocuments.ingredientVector} @@ ${ingredientTsQuery}`,
        ),
        options.maxTotalTime === null
          ? undefined
          : and(
              sql`${recipes.totalTime} IS NOT NULL`,
              lte(recipes.totalTime, options.maxTotalTime),
            ),
        recipeSourceCondition(options.source),
        tagFilter,
        cursorFilter,
      ),
    )
    .orderBy(
      ...(options.sort
        ? recipeKeysetOrder(options.sort)
        : [
            desc(exactTitle),
            desc(titleMatch),
            desc(relevanceRank),
            desc(recipes.createdAt),
            desc(recipes.id),
          ]),
    )
    .limit(options.limit + 1);
}

export async function searchUserRecipes(
  db: DbClient,
  options: SearchUserRecipesOptions,
) {
  const { query, tagIds, maxTotalTime, limit, ingredientQuery } =
    normalizeRecipeSearchInput(options);

  const analysisResult = await db.execute(sql`
    SELECT cardinality(
      tsvector_to_array(to_tsvector('english', ${query}))
    )::integer AS lexeme_count
  `);
  const lexemeCount = Number(analysisResult.rows[0]?.lexeme_count ?? 0);
  if (lexemeCount < 1 || lexemeCount > MAX_RECIPE_SEARCH_LEXEMES) {
    throw new ServiceError(
      "BAD_REQUEST",
      lexemeCount < 1
        ? "Recipe search must contain a searchable word."
        : `Recipe search can contain at most ${MAX_RECIPE_SEARCH_LEXEMES} searchable words.`,
    );
  }

  const sort = isRecipeKeysetSort(options.sort) ? options.sort : undefined;
  const source = options.source;
  const fingerprint = await searchFingerprint({
    query,
    tagIds,
    maxTotalTime,
    sort,
    source,
  });
  const cursor =
    options.cursor && !sort ? decodeRecipeSearchCursor(options.cursor) : null;
  const keysetCursor =
    options.cursor && sort
      ? decodeRecipeKeysetCursor(options.cursor, sort)
      : null;
  if (
    (cursor && cursor.fingerprint !== fingerprint) ||
    (keysetCursor && keysetCursor.f !== fingerprint)
  ) {
    throw new ServiceError(
      "BAD_REQUEST",
      "Recipe search cursor does not match this search.",
    );
  }

  const rankedRows = await buildRecipeSearchQuery(db, {
    ownerId: options.ownerId,
    query,
    ingredientQuery,
    tagIds,
    maxTotalTime,
    limit,
    cursor,
    sort,
    source,
    keysetCursor,
  });

  const pageRows = rankedRows.slice(0, limit);
  const items = await hydrateRecipeListRows(db, pageRows);

  const lastRow = pageRows.at(-1);
  const nextCursor =
    rankedRows.length > limit && lastRow
      ? sort
        ? encodeRecipeKeysetCursor(
            recipeKeysetCursorFor(sort, lastRow, fingerprint),
          )
        : encodeRecipeSearchCursor({
            v: 1,
            fingerprint,
            exactTitle: Boolean(lastRow.exactTitle),
            titleMatch: Boolean(lastRow.titleMatch),
            rank: Number(lastRow.relevanceRank),
            createdAt: lastRow.recipe.createdAt.toISOString(),
            recipeId: lastRow.recipe.id,
          })
      : undefined;

  return { items, nextCursor };
}
