import { TRPCError } from "@trpc/server";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  filterSelectedRecipeIngredients,
  groupItemIds,
  mergeShoppingListItems,
  shoppingRouter,
} from "./shopping-router";

/** Render a Drizzle condition so a test can see what it filters on. */
const renderSql = (condition: unknown) =>
  new PgDialect().sqlToQuery(condition as never);

const serviceMocks = vi.hoisted(() => ({
  canUserAccessShoppingList: vi.fn(),
  canUserEditShoppingList: vi.fn(),
  insertShoppingListItem: vi.fn(),
}));

vi.mock("@repo/db/services", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/db/services")>();
  return { ...actual, ...serviceMocks };
});

const ingredients = [
  { id: 1, quantity: "2", unit: "cup", name: "flour" },
  { id: 2, quantity: "1", unit: null, name: "egg" },
  { id: 3, quantity: null, unit: null, name: "salt" },
];

function createCaller(db: unknown = {}) {
  return shoppingRouter.createCaller({
    db,
    env: {},
    req: new Request("https://api.cookclub.app/trpc"),
    resHeaders: new Headers(),
    user: { id: "user-1" },
    waitUntil: vi.fn(),
    requestId: "test-request",
  } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  serviceMocks.canUserAccessShoppingList.mockResolvedValue(true);
  serviceMocks.canUserEditShoppingList.mockResolvedValue(true);
  serviceMocks.insertShoppingListItem.mockResolvedValue({
    id: 100,
    displayName: "milk",
  });
});

describe("filterSelectedRecipeIngredients", () => {
  it("returns every recipe ingredient when no selection is provided", () => {
    expect(filterSelectedRecipeIngredients(ingredients)).toEqual(ingredients);
  });

  it("returns only selected recipe ingredients", () => {
    expect(filterSelectedRecipeIngredients(ingredients, [3, 1])).toEqual([
      ingredients[0],
      ingredients[2],
    ]);
  });

  it("rejects empty ingredient selections", () => {
    expect(() => filterSelectedRecipeIngredients(ingredients, [])).toThrow(
      TRPCError,
    );
  });

  it("rejects ingredients that do not belong to the recipe", () => {
    expect(() =>
      filterSelectedRecipeIngredients(ingredients, [1, 999]),
    ).toThrow(TRPCError);
  });
});

describe("shoppingRouter shared-list mutations", () => {
  it("adds manual items to the explicitly selected shared list", async () => {
    const db = {};
    const caller = createCaller(db);

    await expect(
      caller.addManualItem({
        ingredientText: "2 cups milk",
        shoppingListId: 42,
      }),
    ).resolves.toEqual({
      success: true,
      item: { id: 100, displayName: "milk" },
    });

    expect(serviceMocks.canUserEditShoppingList).toHaveBeenCalledWith(
      db,
      "user-1",
      42,
    );
    expect(serviceMocks.insertShoppingListItem).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ shoppingListId: 42 }),
    );
  });

  it("rejects every shared-list mutation when the user cannot edit the list", async () => {
    serviceMocks.canUserEditShoppingList.mockResolvedValue(false);
    const transaction = vi.fn();
    const caller = createCaller({ transaction });

    await expect(
      caller.clearCheckedItems({ shoppingListId: 42 }),
    ).rejects.toHaveProperty("code", "FORBIDDEN");
    await expect(
      caller.removeRecipeFromList({ recipeId: 7, shoppingListId: 42 }),
    ).rejects.toHaveProperty("code", "FORBIDDEN");
    await expect(
      caller.addManualItem({ ingredientText: "milk", shoppingListId: 42 }),
    ).rejects.toHaveProperty("code", "FORBIDDEN");

    expect(serviceMocks.canUserEditShoppingList).toHaveBeenCalledTimes(3);
    expect(transaction).not.toHaveBeenCalled();
    expect(serviceMocks.insertShoppingListItem).not.toHaveBeenCalled();
  });

  it("allows an editable shared list to clear items and remove recipes", async () => {
    const selectBuilder = {
      from: vi.fn(),
      where: vi.fn().mockResolvedValue([]),
    };
    selectBuilder.from.mockReturnValue(selectBuilder);
    const deleteBuilder = {
      where: vi.fn().mockResolvedValue(undefined),
    };
    const tx = {
      select: vi.fn(() => selectBuilder),
      delete: vi.fn(() => deleteBuilder),
    };
    const db = {
      transaction: vi.fn(
        async (callback: (transaction: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    };
    const caller = createCaller(db);

    await expect(
      caller.clearCheckedItems({ shoppingListId: 42 }),
    ).resolves.toEqual({ success: true });
    await expect(
      caller.removeRecipeFromList({ recipeId: 7, shoppingListId: 42 }),
    ).resolves.toEqual({ success: true });

    expect(serviceMocks.canUserEditShoppingList).toHaveBeenNthCalledWith(
      1,
      db,
      "user-1",
      42,
    );
    expect(serviceMocks.canUserEditShoppingList).toHaveBeenNthCalledWith(
      2,
      db,
      "user-1",
      42,
    );
    expect(db.transaction).toHaveBeenCalledTimes(2);
  });

  it("rejects an item ID that does not belong to the selected list", async () => {
    const selectBuilder = {
      from: vi.fn(),
      where: vi.fn().mockResolvedValue([]),
    };
    selectBuilder.from.mockReturnValue(selectBuilder);
    const db = { select: vi.fn(() => selectBuilder) };
    const caller = createCaller(db);

    await expect(
      caller.removeItem({ itemId: 9, shoppingListId: 42 }),
    ).rejects.toHaveProperty("code", "NOT_FOUND");

    expect(serviceMocks.canUserAccessShoppingList).not.toHaveBeenCalled();
  });
});

describe("merged list items", () => {
  const selectReturning = (rows: unknown[]) => {
    const builder = { from: vi.fn(), where: vi.fn().mockResolvedValue(rows) };
    builder.from.mockReturnValue(builder);
    return builder;
  };

  it("de-duplicates the item IDs and caps how many are sent", () => {
    expect(groupItemIds(1, [1, 2, 2, 3])).toEqual([1, 2, 3]);
    expect(groupItemIds(4)).toEqual([4]);
    expect(() =>
      groupItemIds(
        0,
        Array.from({ length: 120 }, (_, i) => i + 1),
      ),
    ).toThrow(TRPCError);
  });

  it("ticks every row behind an item to the state the app asked for", async () => {
    const select = selectReturning([
      { id: 5, isChecked: true, listId: 42 },
      { id: 6, isChecked: false, listId: 42 },
    ]);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where: updateWhere }));
    const db = { select: vi.fn(() => select), update: vi.fn(() => ({ set })) };

    // Explicit state wins over the first row's current state
    await expect(
      createCaller(db).toggleItemChecked({
        itemId: 5,
        itemIds: [5, 6],
        isChecked: true,
      }),
    ).resolves.toEqual({ success: true, isChecked: true });
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ isChecked: true }),
    );
    expect(updateWhere).toHaveBeenCalledTimes(1);
  });

  it("still flips a single row for older apps", async () => {
    const select = selectReturning([{ id: 5, isChecked: true, listId: 42 }]);
    const set = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
    const db = { select: vi.fn(() => select), update: vi.fn(() => ({ set })) };

    await expect(
      createCaller(db).toggleItemChecked({ itemId: 5 }),
    ).resolves.toEqual({ success: true, isChecked: false });
  });

  it("rejects a tick when the main row is missing", async () => {
    const db = { select: vi.fn(() => selectReturning([])) };
    await expect(
      createCaller(db).toggleItemChecked({ itemId: 5, itemIds: [6] }),
    ).rejects.toHaveProperty("code", "NOT_FOUND");
  });

  it("deletes every row behind an item and drops recipes left empty", async () => {
    const select = selectReturning([
      { id: 5, sourceRecipeId: 7 },
      { id: 6, sourceRecipeId: 8 },
    ]);
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const remaining = {
      from: vi.fn(),
      where: vi.fn(),
      limit: vi.fn().mockResolvedValue([]),
    };
    remaining.from.mockReturnValue(remaining);
    remaining.where.mockReturnValue(remaining);
    const tx = {
      delete: vi.fn(() => ({ where: deleteWhere })),
      select: vi.fn(() => remaining),
    };
    const db = {
      select: vi.fn(() => select),
      transaction: vi.fn(
        async (callback: (transaction: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    };

    await expect(
      createCaller(db).removeItem({
        itemId: 5,
        itemIds: [5, 6],
        shoppingListId: 42,
      }),
    ).resolves.toEqual({ success: true });
    // One delete for the rows, one for each recipe left with nothing
    expect(tx.delete).toHaveBeenCalledTimes(3);
  });
});

describe("mergeShoppingListItems", () => {
  const row = (
    id: number,
    name: string,
    quantity: string | null,
    recipe: [number, string] | null,
    isChecked = false,
  ) => ({
    id,
    ingredientName: name,
    displayName: name,
    quantity,
    unit: null,
    isChecked,
    aisle: "Fresh Produce",
    sourceRecipeId: recipe?.[0] ?? null,
    sourceRecipeName: recipe?.[1] ?? null,
  });

  it("merges rows per ingredient, keyed by the newest row", () => {
    // Newest first, as the query orders them
    const [onions, garlic] = mergeShoppingListItems([
      row(9, "onions", "2", [2, "Butter chicken"]),
      row(5, "onions", "1", [1, "Prawn pad thai"], true),
      row(4, "garlic", null, null),
    ]).sort((a, b) => b.id - a.id);

    expect(onions).toMatchObject({
      id: 9,
      displayName: "onions",
      quantity: 3,
      displayText: "3 onions",
      // One recipe's share is ticked, so the item is still to get
      isChecked: false,
      sourceItems: [
        { id: 9, quantity: 2, isChecked: false, sourceRecipeId: 2 },
        { id: 5, quantity: 1, isChecked: true, sourceRecipeId: 1 },
      ],
    });
    expect(garlic).toMatchObject({ id: 4, quantity: 0, displayText: "garlic" });
  });

  it("counts an item ticked once every row is", () => {
    const [item] = mergeShoppingListItems([
      row(9, "onions", "2", [2, "Butter chicken"], true),
      row(5, "onions", "1", [1, "Prawn pad thai"], true),
    ]);
    expect(item?.isChecked).toBe(true);
  });
});

describe("list scoping", () => {
  it("only ticks rows on the item's own list", async () => {
    const select = {
      from: vi.fn(),
      where: vi
        .fn()
        .mockResolvedValue([{ id: 5, isChecked: false, listId: 42 }]),
    };
    select.from.mockReturnValue(select);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const db = {
      select: vi.fn(() => select),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateWhere })) })),
    };

    await createCaller(db).toggleItemChecked({
      itemId: 5,
      itemIds: [5, 77],
      isChecked: true,
    });

    const { sql, params } = renderSql(updateWhere.mock.calls[0]![0]);
    expect(sql).toMatch(/"id" in \(\$1, \$2\)/);
    expect(sql).toContain('"shopping_list_id" = $3');
    expect(params).toEqual([5, 77, 42]);
  });

  it("only deletes rows on the selected list", async () => {
    const select = {
      from: vi.fn(),
      where: vi.fn().mockResolvedValue([{ id: 5, sourceRecipeId: null }]),
    };
    select.from.mockReturnValue(select);
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const tx = { delete: vi.fn(() => ({ where: deleteWhere })) };
    const db = {
      select: vi.fn(() => select),
      transaction: vi.fn(
        async (callback: (transaction: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    };

    await createCaller(db).removeItem({
      itemId: 5,
      itemIds: [5, 77],
      shoppingListId: 42,
    });

    // The lookup is scoped to the list, so row 77 from another list never
    // comes back and is never deleted
    const lookup = renderSql(select.where.mock.calls[0]![0]);
    expect(lookup.sql).toContain('"shopping_list_id" = $3');
    expect(lookup.params).toEqual([5, 77, 42]);
    const removal = renderSql(deleteWhere.mock.calls[0]![0]);
    expect(removal.params).toEqual([5, 42]);
  });
});
