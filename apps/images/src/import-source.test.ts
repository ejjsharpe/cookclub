import { describe, expect, it, vi } from "vitest";

import { getImportSource, stageImportSource } from "./import-source";

const JOB_ID = "0d7de7c2-b3fc-4644-87ca-cf00e1cbf1b2";
const OWNER_ID = "user-1";
const TEMP_KEY = "temp/user-1/source.png";

function asset(key: string) {
  return {
    url: `https://images.example.com/${key}`,
    publicUrl: `https://images.example.com/${key}`,
    storageKey: key,
    key,
    width: 1200,
    height: 800,
    contentType: "image/jpeg" as const,
    byteSize: 4,
    thumbhash: "",
  };
}

function sourceObject(
  contentType = "image/png",
  size = 4,
  bytes = new Uint8Array([1, 2, 3, 4]).buffer,
) {
  return {
    size,
    httpMetadata: { contentType },
    arrayBuffer: vi.fn().mockResolvedValue(bytes),
  };
}

describe("recipe import source staging", () => {
  it("validates ownership, normalises once and deletes temp after inspection", async () => {
    const destinationKey = `imports/${JOB_ID}/source.jpg`;
    const source = sourceObject();
    const put = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);
    const bucket = {
      head: vi.fn().mockResolvedValue(null),
      get: vi.fn().mockResolvedValue(source),
      put,
      delete: remove,
    };
    const normalize = vi
      .fn()
      .mockResolvedValue(new Uint8Array([9, 8, 7, 6]).buffer);
    const inspect = vi.fn().mockResolvedValue(asset(destinationKey));

    await expect(
      stageImportSource(
        { bucket: bucket as never, normalize, inspect },
        TEMP_KEY,
        OWNER_ID,
        JOB_ID,
      ),
    ).resolves.toEqual(asset(destinationKey));

    expect(normalize).toHaveBeenCalledOnce();
    expect(put).toHaveBeenCalledWith(destinationKey, expect.any(ArrayBuffer), {
      httpMetadata: { contentType: "image/jpeg" },
      customMetadata: {
        ownerId: OWNER_ID,
        jobId: JOB_ID,
        sourceTempKey: TEMP_KEY,
      },
    });
    expect(inspect).toHaveBeenCalledBefore(remove);
    expect(remove).toHaveBeenCalledWith(TEMP_KEY);
  });

  it("rejects another user's temp object", async () => {
    await expect(
      stageImportSource(
        {
          bucket: {} as never,
          normalize: vi.fn(),
          inspect: vi.fn(),
        },
        "temp/other/source.jpg",
        OWNER_ID,
        JOB_ID,
      ),
    ).rejects.toThrow("does not belong");
  });

  it.each([
    ["image/gif", 100],
    ["image/jpeg", 10 * 1024 * 1024 + 1],
  ])("rejects invalid source metadata (%s, %s bytes)", async (type, size) => {
    const bucket = {
      head: vi.fn().mockResolvedValue(null),
      get: vi.fn().mockResolvedValue(sourceObject(type, size)),
    };
    await expect(
      stageImportSource(
        {
          bucket: bucket as never,
          normalize: vi.fn(),
          inspect: vi.fn(),
        },
        TEMP_KEY,
        OWNER_ID,
        JOB_ID,
      ),
    ).rejects.toThrow("invalid");
  });

  it("replays an already valid staged object without requiring temp", async () => {
    const destinationKey = `imports/${JOB_ID}/source.jpg`;
    const bucket = {
      head: vi.fn().mockResolvedValue({
        size: 4,
        httpMetadata: { contentType: "image/jpeg" },
        customMetadata: {
          ownerId: OWNER_ID,
          jobId: JOB_ID,
          sourceTempKey: TEMP_KEY,
        },
      }),
      get: vi.fn(),
      delete: vi.fn(),
    };
    const inspect = vi.fn().mockResolvedValue(asset(destinationKey));
    const normalize = vi.fn();

    await stageImportSource(
      { bucket: bucket as never, normalize, inspect },
      TEMP_KEY,
      OWNER_ID,
      JOB_ID,
    );

    expect(inspect).toHaveBeenCalledWith(destinationKey);
    expect(bucket.get).not.toHaveBeenCalled();
    expect(normalize).not.toHaveBeenCalled();
    expect(bucket.delete).toHaveBeenCalledWith(TEMP_KEY);
  });

  it("stages additional sources under stable numbered keys", async () => {
    const destinationKey = `imports/${JOB_ID}/source-2.jpg`;
    const bucket = {
      head: vi.fn().mockResolvedValue(null),
      get: vi.fn().mockResolvedValue(sourceObject()),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const inspect = vi.fn().mockResolvedValue(asset(destinationKey));

    await expect(
      stageImportSource(
        {
          bucket: bucket as never,
          normalize: vi
            .fn()
            .mockResolvedValue(new Uint8Array([9, 8, 7, 6]).buffer),
          inspect,
        },
        "temp/user-1/source-2.png",
        OWNER_ID,
        JOB_ID,
        1,
      ),
    ).resolves.toEqual(asset(destinationKey));

    expect(inspect).toHaveBeenCalledWith(destinationKey);
  });

  it("rejects normalized bytes above the per-source budget", async () => {
    const bucket = {
      head: vi.fn().mockResolvedValue(null),
      get: vi.fn().mockResolvedValue(sourceObject()),
      put: vi.fn(),
      delete: vi.fn(),
    };

    await expect(
      stageImportSource(
        {
          bucket: bucket as never,
          normalize: vi
            .fn()
            .mockResolvedValue(new Uint8Array([1, 2, 3, 4]).buffer),
          inspect: vi.fn(),
        },
        TEMP_KEY,
        OWNER_ID,
        JOB_ID,
        0,
        3,
      ),
    ).rejects.toThrow("too large after normalization");

    expect(bucket.put).not.toHaveBeenCalled();
    expect(bucket.delete).not.toHaveBeenCalled();
  });

  it("streams only a bounded normalised JPEG", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3, 4]));
        controller.close();
      },
    });
    const bucket = {
      get: vi.fn().mockResolvedValue({
        size: 4,
        etag: "etag-1",
        body,
        httpMetadata: { contentType: "image/jpeg" },
      }),
    };

    const response = await getImportSource(bucket as never, JOB_ID);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.arrayBuffer()).toEqual(
      new Uint8Array([1, 2, 3, 4]).buffer,
    );
  });

  it("reads an additional source by its index", async () => {
    const bucket = {
      get: vi.fn().mockResolvedValue({
        size: 4,
        etag: "etag-2",
        body: new Blob([new Uint8Array([5, 6, 7, 8])]).stream(),
        httpMetadata: { contentType: "image/jpeg" },
      }),
    };

    const response = await getImportSource(bucket as never, JOB_ID, 1);

    expect(bucket.get).toHaveBeenCalledWith(`imports/${JOB_ID}/source-2.jpg`);
    expect(response.status).toBe(200);
  });
});
