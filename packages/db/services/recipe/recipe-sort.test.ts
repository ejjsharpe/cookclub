import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";

import * as schema from "../../schemas";
import { recipes } from "../../schemas";
import { ServiceError } from "../errors";
import { buildRecipeSearchQuery } from "./recipe-search.service";
import {
  decodeRecipeKeysetCursor,
  encodeRecipeKeysetCursor,
  recipeKeysetAfter,
  recipeKeysetOrder,
  recipeSourceCondition,
} from "./recipe-sort";

// Typed from the schema-aware mock so query builders keep their table types.
const mockDb = () => drizzle.mock({ schema });

function toSql(
  build: (db: ReturnType<typeof mockDb>) => {
    toSQL: () => { sql: string; params: unknown[] };
  },
) {
  return build(mockDb()).toSQL();
}

describe("recipe keyset cursor", () => {
  it("round-trips name and time cursors, including unknown times", () => {
    for (const cursor of [
      { v: 1, sort: "name", key: "çurry ünder", id: 7 } as const,
      { v: 1, sort: "time", key: 25, id: 8, f: "fp" } as const,
      { v: 1, sort: "time", key: null, id: 9 } as const,
    ]) {
      expect(
        decodeRecipeKeysetCursor(encodeRecipeKeysetCursor(cursor), cursor.sort),
      ).toEqual(cursor);
    }
  });

  it("rejects a cursor from another sort or a malformed one", () => {
    const nameCursor = encodeRecipeKeysetCursor({
      v: 1,
      sort: "name",
      key: "a",
      id: 1,
    });
    expect(() => decodeRecipeKeysetCursor(nameCursor, "time")).toThrow(
      ServiceError,
    );
    expect(() => decodeRecipeKeysetCursor("not a cursor!", "name")).toThrow(
      ServiceError,
    );
  });
});

describe("recipe keyset ordering", () => {
  it("orders A-Z by lowercased name, then id", () => {
    const { sql } = toSql((db) =>
      db
        .select({ id: recipes.id })
        .from(recipes)
        .where(recipeKeysetAfter({ v: 1, sort: "name", key: "m", id: 3 }))
        .orderBy(...recipeKeysetOrder("name")),
    );
    expect(sql).toContain('lower("recipes"."name")');
    expect(sql).toMatch(/\) > \(/);
    expect(sql).toMatch(
      /order by lower\("recipes"."name"\) asc, "recipes"."id" asc/,
    );
  });

  it("puts recipes without a time last and pages past them by id", () => {
    const known = toSql((db) =>
      db
        .select({ id: recipes.id })
        .from(recipes)
        .where(recipeKeysetAfter({ v: 1, sort: "time", key: 20, id: 3 }))
        .orderBy(...recipeKeysetOrder("time")),
    );
    expect(known.sql).toContain("asc nulls last");
    expect(known.sql).toContain('"recipes"."total_time" > $1');
    expect(known.sql).toContain('"recipes"."total_time" IS NULL');

    const unknown = toSql((db) =>
      db
        .select({ id: recipes.id })
        .from(recipes)
        .where(recipeKeysetAfter({ v: 1, sort: "time", key: null, id: 3 })),
    );
    expect(unknown.sql).toContain(
      '"recipes"."total_time" IS NULL and "recipes"."id" > $1',
    );
  });
});

describe("recipe source filter", () => {
  it.each([
    ["web", '"recipes"."source_type" = $1', ["url"]],
    ["cook", '"recipes"."source_type" = $1', ["user"]],
    ["mine", '"recipes"."source_type" not in ($1, $2)', ["url", "user"]],
  ] as const)("maps %s to source types", (source, fragment, params) => {
    const result = toSql((db) =>
      db
        .select({ id: recipes.id })
        .from(recipes)
        .where(recipeSourceCondition(source)),
    );
    expect(result.sql).toContain(fragment);
    expect(result.params).toEqual(params);
  });

  it("adds nothing when no source is chosen", () => {
    expect(recipeSourceCondition(undefined)).toBeUndefined();
  });
});

describe("sorted recipe search", () => {
  it("keeps text matching but orders by the chosen sort", () => {
    const { sql } = toSql((db) =>
      buildRecipeSearchQuery(db, {
        ownerId: "owner-1",
        query: "pasta",
        ingredientQuery: "pasta",
        tagIds: [],
        maxTotalTime: null,
        limit: 20,
        cursor: null,
        sort: "time",
        source: "web",
        keysetCursor: { v: 1, sort: "time", key: 15, id: 4, f: "fp" },
      }),
    );
    expect(sql).toContain("recipe_prefix_tsquery");
    expect(sql).toContain('"recipes"."source_type" =');
    expect(sql).toContain("asc nulls last");
    expect(sql.slice(sql.indexOf("order by"))).not.toContain("desc");
  });
});
