import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  filterSelectedRecipeIngredients,
  shoppingRouter,
} from "./shopping-router";

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
