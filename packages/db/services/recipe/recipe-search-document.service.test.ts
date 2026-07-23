import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";

import { buildRecipeSearchDocumentSyncQuery } from "./recipe-search-document.service";
import * as schema from "../../schemas";

describe("recipe search document sync", () => {
  it("inserts only writable columns when search vectors are generated", () => {
    const db = drizzle.mock({ schema });

    const { sql, params } = buildRecipeSearchDocumentSyncQuery(db, 42).toSQL();

    expect(sql).toMatch(
      /insert into "recipe_search_documents" \("recipe_id", "owner_id", "title", "ingredient_names"\)\s+SELECT/,
    );
    expect(sql).not.toContain('"title_vector"');
    expect(sql).not.toContain('"ingredient_vector"');
    expect(sql).not.toContain('"combined_vector"');
    expect(params).toEqual([42]);
  });
});
