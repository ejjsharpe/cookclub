import { describe, expect, it, vi } from "vitest";

import {
  deleteImportImageStagingIds,
  deleteImportImages,
  importImagePrefix,
  listImportImageStagingIds,
} from "./import-staging";

describe("import image staging", () => {
  it("validates job-scoped prefixes", () => {
    expect(importImagePrefix("url-123")).toBe("imports/url-123/");
    expect(() => importImagePrefix("../job")).toThrow(
      "Invalid import image staging id",
    );
  });

  it("deletes every object under the job prefix", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        objects: [
          { key: "imports/job-1/cover.jpg" },
          { key: "imports/job-1/step.jpg" },
        ],
        delimitedPrefixes: [],
        truncated: false,
      })
      .mockResolvedValueOnce({
        objects: [],
        delimitedPrefixes: [],
        truncated: false,
      });
    const deleteObjects = vi.fn().mockResolvedValue(undefined);

    await deleteImportImages(
      { list, delete: deleteObjects } as unknown as R2Bucket,
      "job-1",
    );

    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenCalledWith({
      prefix: "imports/job-1/",
      limit: 1000,
    });
    expect(deleteObjects).toHaveBeenCalledWith([
      "imports/job-1/cover.jpg",
      "imports/job-1/step.jpg",
    ]);
  });

  it("deletes multiple staging prefixes inside one service invocation", async () => {
    const list = vi.fn().mockResolvedValue({
      objects: [],
      delimitedPrefixes: [],
      truncated: false,
    });

    await deleteImportImageStagingIds(
      { list, delete: vi.fn() } as unknown as R2Bucket,
      ["job-1", "job-2", "job-1"],
    );

    expect(list.mock.calls).toEqual([
      [
        {
          prefix: "imports/job-1/",
          limit: 1000,
        },
      ],
      [
        {
          prefix: "imports/job-2/",
          limit: 1000,
        },
      ],
    ]);
  });

  it("lists all validated staging ids across R2 pages", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        objects: [],
        delimitedPrefixes: [
          "imports/job-1/",
          "imports/text_2/",
          "imports/not.valid/",
        ],
        truncated: true,
        cursor: "next-page",
      })
      .mockResolvedValueOnce({
        objects: [],
        delimitedPrefixes: ["imports/image-3/", "imports/job-1/"],
        truncated: false,
      });

    const result = await listImportImageStagingIds({
      list,
    } as unknown as R2Bucket);

    expect(list).toHaveBeenNthCalledWith(1, {
      prefix: "imports/",
      delimiter: "/",
      limit: 1000,
    });
    expect(list).toHaveBeenNthCalledWith(2, {
      prefix: "imports/",
      delimiter: "/",
      limit: 1000,
      cursor: "next-page",
    });
    expect(result).toEqual(["job-1", "text_2", "image-3"]);
  });
});
