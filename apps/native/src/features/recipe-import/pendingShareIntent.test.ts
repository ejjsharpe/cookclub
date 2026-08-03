import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearPendingShareIntent,
  getPendingShareIntent,
  persistDetectedShareIntent,
  updatePendingShareIntent,
} from "./pendingShareIntent";

const mocks = vi.hoisted(() => ({
  values: new Map<string, string>(),
  copied: [] as { from: string; to: string }[],
  deleted: [] as string[],
}));

vi.mock("@/lib/mmkv", () => ({
  storage: {
    getString: (key: string) => mocks.values.get(key),
    set: (key: string, value: string) => mocks.values.set(key, value),
    remove: (key: string) => mocks.values.delete(key),
  },
}));

vi.mock("expo-crypto", () => ({
  randomUUID: () => "81083694-1ff6-4d70-8fc5-f00f1677cc9f",
}));

vi.mock("expo-file-system", () => {
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts
        .map((part) => (typeof part === "string" ? part : part.uri))
        .join("/");
    }
    create() {}
  }
  class File {
    uri: string;
    exists = true;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts
        .map((part) => (typeof part === "string" ? part : part.uri))
        .join("/");
    }
    async copy(destination: File) {
      mocks.copied.push({ from: this.uri, to: destination.uri });
    }
    delete() {
      mocks.deleted.push(this.uri);
    }
  }
  return {
    Directory,
    File,
    Paths: { document: { uri: "file:///documents" } },
  };
});

describe("durable pending share intent", () => {
  beforeEach(() => {
    mocks.values.clear();
    mocks.copied.length = 0;
    mocks.deleted.length = 0;
    vi.useRealTimers();
  });

  it("copies image shares into app-owned storage without base64", async () => {
    const record = await persistDetectedShareIntent({
      type: "image",
      content: "file:///share-extension/photo.png",
      mimeType: "image/png",
    });

    expect(mocks.copied).toEqual([
      {
        from: "file:///share-extension/photo.png",
        to: "file:///documents/recipe-import/81083694-1ff6-4d70-8fc5-f00f1677cc9f.png",
      },
    ]);
    expect(record).toMatchObject({
      version: 2,
      id: "81083694-1ff6-4d70-8fc5-f00f1677cc9f",
      type: "image",
      fileUri:
        "file:///documents/recipe-import/81083694-1ff6-4d70-8fc5-f00f1677cc9f.png",
    });
    expect(JSON.stringify(record)).not.toContain("base64");
    expect(getPendingShareIntent()).toEqual(record);
  });

  it("retains completed upload state across a failed create attempt", async () => {
    const record = await persistDetectedShareIntent({
      type: "image",
      content: "file:///shared/photo.jpg",
      mimeType: "image/jpeg",
    });
    updatePendingShareIntent(record.id, {
      importType: "smart",
      uploadKey: "temp/user/source.jpg",
    });

    expect(getPendingShareIntent()).toMatchObject({
      id: record.id,
      importType: "smart",
      uploadKey: "temp/user/source.jpg",
    });
  });

  it("deletes the app-owned image only after explicit acceptance cleanup", async () => {
    const record = await persistDetectedShareIntent({
      type: "image",
      content: "file:///shared/photo.jpg",
      mimeType: "image/jpeg",
    });
    expect(record.type).toBe("image");
    if (record.type !== "image") throw new Error("Expected image record");
    expect(mocks.deleted).toEqual([]);

    clearPendingShareIntent(record.id);

    expect(mocks.deleted).toEqual([record.fileUri]);
    expect(getPendingShareIntent()).toBeNull();
  });

  it("expires abandoned records after 24 hours", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T10:00:00.000Z"));
    const record = await persistDetectedShareIntent({
      type: "image",
      content: "file:///shared/photo.jpg",
      mimeType: "image/jpeg",
    });
    expect(record.type).toBe("image");
    if (record.type !== "image") throw new Error("Expected image record");
    vi.setSystemTime(new Date("2026-07-28T10:00:01.000Z"));

    expect(getPendingShareIntent()).toBeNull();
    expect(mocks.deleted).toEqual([record.fileUri]);
  });
});
