import { describe, expect, it } from "vitest";

import { moveArrayItem } from "./reorder";

describe("moveArrayItem", () => {
  it("moves an item earlier without mutating the input", () => {
    const items = ["one", "two", "three"];

    expect(moveArrayItem(items, 2, 0)).toEqual(["three", "one", "two"]);
    expect(items).toEqual(["one", "two", "three"]);
  });

  it("moves an item later", () => {
    expect(moveArrayItem(["one", "two", "three"], 0, 1)).toEqual([
      "two",
      "one",
      "three",
    ]);
  });

  it("returns an equivalent copy for an invalid move", () => {
    const items = ["one", "two"];
    const result = moveArrayItem(items, 0, 3);

    expect(result).toEqual(items);
    expect(result).not.toBe(items);
  });
});
