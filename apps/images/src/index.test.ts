import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generatePresignedUploadUrl: vi.fn(),
  createThumbhashFromJpegBytes: vi.fn(() => "test-thumbhash"),
}));

vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class<Environment> {
    protected env: Environment;

    constructor(_ctx: ExecutionContext, env: Environment) {
      this.env = env;
    }
  },
}));

vi.mock("./presign", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./presign")>()),
  generatePresignedUploadUrl: mocks.generatePresignedUploadUrl,
}));

vi.mock("./thumbhash", () => ({
  createThumbhashFromJpegBytes: mocks.createThumbhashFromJpegBytes,
}));

// eslint-disable-next-line import/first
import worker, { ImageService } from "./index";

type StoredRecord = {
  bytes: ArrayBuffer;
  contentType: string;
  uploaded?: Date;
};

function bytes(...values: number[]) {
  return new Uint8Array(values).buffer;
}

function createBucket(initial: Record<string, StoredRecord> = {}) {
  const records = new Map(Object.entries(initial));

  const objectFor = (key: string, record: StoredRecord) => {
    const data = () => record.bytes.slice(0);
    return {
      key,
      version: "test-version",
      size: record.bytes.byteLength,
      etag: `etag-${key}`,
      httpEtag: `"etag-${key}"`,
      checksums: { toJSON: () => ({}) },
      uploaded: record.uploaded ?? new Date(),
      httpMetadata: { contentType: record.contentType },
      customMetadata: { source: "test" },
      storageClass: "Standard",
      writeHttpMetadata: (headers: Headers) => {
        headers.set("Content-Type", record.contentType);
      },
      body: new Blob([record.bytes]).stream(),
      bodyUsed: false,
      arrayBuffer: vi.fn(async () => data()),
      bytes: vi.fn(async () => new Uint8Array(data())),
      text: vi.fn(async () => new TextDecoder().decode(data())),
      json: vi.fn(async () => JSON.parse(new TextDecoder().decode(data()))),
      blob: vi.fn(async () => new Blob([data()])),
    };
  };

  return {
    records,
    get: vi.fn(async (key: string) => {
      const record = records.get(key);
      return record ? objectFor(key, record) : null;
    }),
    head: vi.fn(async (key: string) => {
      const record = records.get(key);
      return record ? objectFor(key, record) : null;
    }),
    put: vi.fn(
      async (
        key: string,
        value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null,
        options?: R2PutOptions,
      ) => {
        const data = await new Response(value as BodyInit | null).arrayBuffer();
        const stored = {
          bytes: data,
          contentType:
            options?.httpMetadata && "contentType" in options.httpMetadata
              ? (options.httpMetadata.contentType ?? "application/octet-stream")
              : "application/octet-stream",
        };
        records.set(key, stored);
        return objectFor(key, stored);
      },
    ),
    delete: vi.fn(async (key: string) => {
      records.delete(key);
    }),
    list: vi.fn(),
    createMultipartUpload: vi.fn(),
    resumeMultipartUpload: vi.fn(),
  };
}

function createTransformer() {
  const transform = vi.fn();
  const output = vi.fn();
  const draw = vi.fn();
  const response = vi.fn(
    () =>
      new Response(bytes(9, 8, 7), {
        status: 200,
        headers: { "Content-Type": "image/avif" },
      }),
  );
  const image = vi.fn(() => new Blob([bytes(9, 8, 7)]).stream());
  const result = { response, contentType: () => "image/avif", image };
  const handle = { transform, draw, output };
  output.mockResolvedValue(result);
  transform.mockReturnValue(handle);
  draw.mockReturnValue(handle);

  return {
    binding: {
      info: vi.fn(async () => ({
        width: 640,
        height: 480,
        fileSize: 3,
        format: "image/jpeg" as const,
      })),
      input: vi.fn(() => handle),
      hosted: {
        image: vi.fn(),
        upload: vi.fn(),
        list: vi.fn(),
      },
    },
    transform,
    output,
    response,
  };
}

function createEnv(bucket = createBucket()) {
  const transformer = createTransformer();
  return {
    env: {
      IMAGES: bucket,
      IMAGE_TRANSFORMER: transformer.binding,
      PUBLIC_URL: "https://images.example.com",
      R2_ACCOUNT_ID: "account-id",
      R2_S3_API_URL: "https://r2.example.com/bucket",
      R2_BUCKET_NAME: "bucket",
      R2_ACCESS_KEY_ID: "access-key",
      R2_SECRET_ACCESS_KEY: "secret-key",
    } as unknown as Cloudflare.Env,
    bucket,
    transformer,
  };
}

function createService(env: ReturnType<typeof createEnv>["env"]) {
  return new ImageService({} as ExecutionContext, env);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("public image worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("serves health checks and rejects unsupported transformation inputs", async () => {
    const { env } = createEnv();

    const health = await worker.fetch(
      new Request("https://images.example.com/health"),
      env,
      {} as ExecutionContext,
    );
    const unsupported = await worker.fetch(
      new Request("https://images.example.com/photo.jpg?width=100"),
      env,
      {} as ExecutionContext,
    );

    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });
    expect(unsupported.status).toBe(400);
    expect(unsupported.headers.get("x-cookclub-image-transform")).toBe(
      "unsupported",
    );
    expect(unsupported.headers.get("cache-control")).toBe("no-store");
  });

  it("serves original R2 objects with immutable metadata", async () => {
    const { env } = createEnv(
      createBucket({
        "recipes/covers/recipe-1/photo.jpg": {
          bytes: bytes(1, 2, 3),
          contentType: "image/jpeg",
        },
      }),
    );

    const response = await worker.fetch(
      new Request(
        "https://images.example.com/recipes/covers/recipe-1/photo.jpg",
      ),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(response.headers.get("x-cookclub-image-transform")).toBe("original");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it("returns a clear 404 for a missing original", async () => {
    const { env } = createEnv();

    const response = await worker.fetch(
      new Request("https://images.example.com/missing.jpg"),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Image not found" });
  });

  it("transforms stored bytes and negotiates AVIF from Accept", async () => {
    const { env, transformer } = createEnv(
      createBucket({
        "photo.jpg": { bytes: bytes(1, 2, 3), contentType: "image/jpeg" },
      }),
    );

    const response = await worker.fetch(
      new Request("https://images.example.com/photo.jpg?preset=feed_720", {
        headers: { Accept: "image/avif,image/webp,image/*" },
      }),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    expect(transformer.transform).toHaveBeenCalledWith({
      width: 720,
      height: 540,
      fit: "crop",
      sharpen: 1,
    });
    expect(transformer.output).toHaveBeenCalledWith({
      format: "image/avif",
      quality: 85,
      anim: false,
    });
    expect(response.headers.get("vary")).toBe("Accept");
    expect(response.headers.get("x-cookclub-image-transform")).toBe(
      "transformed",
    );
    expect(response.headers.get("etag")).toContain("feed_720:image/avif");
  });

  it("turns image binding exceptions into non-cacheable 502 responses", async () => {
    const { env, transformer } = createEnv(
      createBucket({
        "photo.jpg": { bytes: bytes(1), contentType: "image/jpeg" },
      }),
    );
    transformer.binding.input.mockImplementationOnce(() => {
      throw new Error("binding unavailable");
    });
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const response = await worker.fetch(
      new Request("https://images.example.com/photo.jpg?preset=feed_720"),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-cookclub-image-transform")).toBe("failed");
    expect(await response.json()).toEqual({
      error: "Image transformation failed",
      message: "binding unavailable",
    });
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('"event":"image_transform_failed"'),
    );
  });
});

describe("image cleanup schedule", () => {
  it("paginates temp objects and deletes only objects older than 24 hours", async () => {
    const { env, bucket } = createEnv();
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const recent = new Date(Date.now() - 23 * 60 * 60 * 1000);
    bucket.list
      .mockResolvedValueOnce({
        objects: [
          { key: "temp/user/old-1.jpg", uploaded: old },
          { key: "temp/user/recent.jpg", uploaded: recent },
        ],
        truncated: true,
        cursor: "next-page",
      })
      .mockResolvedValueOnce({
        objects: Array.from({ length: 101 }, (_, index) => ({
          key: `temp/user/old-${index + 2}.jpg`,
          uploaded: old,
        })),
        truncated: false,
      });
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await worker.scheduled({} as ScheduledEvent, env, {} as ExecutionContext);

    expect(bucket.list).toHaveBeenNthCalledWith(1, {
      prefix: "temp/",
      cursor: undefined,
    });
    expect(bucket.list).toHaveBeenNthCalledWith(2, {
      prefix: "temp/",
      cursor: "next-page",
    });
    expect(bucket.delete).toHaveBeenCalledTimes(102);
    expect(bucket.delete).toHaveBeenCalledWith("temp/user/old-1.jpg");
    expect(bucket.delete).toHaveBeenCalledWith("temp/user/old-102.jpg");
    expect(bucket.delete).not.toHaveBeenCalledWith("temp/user/recent.jpg");
    expect(consoleSpy).toHaveBeenCalledWith(
      "Cleaned up 102 orphaned temp images",
    );
  });
});

describe("ImageService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("verifies only bounded objects with supported metadata", async () => {
    const { env } = createEnv(
      createBucket({
        valid: { bytes: bytes(1), contentType: "image/jpeg" },
        invalid: { bytes: bytes(2), contentType: "image/gif" },
      }),
    );

    await expect(
      createService(env).verify(["valid", "invalid", "missing"]),
    ).resolves.toEqual({
      valid: false,
      results: [
        { key: "valid", exists: true },
        { key: "invalid", exists: false },
        { key: "missing", exists: false },
      ],
    });
  });

  it("enforces temp ownership and destination key rules before moving", async () => {
    const { env, bucket } = createEnv();

    const result = await createService(env).move(
      [
        { from: "recipes/existing.jpg", to: "avatars/user-1.jpg" },
        {
          from: "temp/another-user/source.jpg",
          to: "avatars/user-1.jpg",
        },
        { from: "temp/user-1/source.jpg", to: "../escape.jpg" },
      ],
      "user-1",
    );

    expect(result.success).toBe(false);
    expect(result.results.map((entry) => entry.error)).toEqual([
      "Invalid source key: must be in temp/",
      "Invalid source key: upload does not belong to user",
      "Invalid destination key",
    ]);
    expect(bucket.get).not.toHaveBeenCalled();
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("commits a valid move before deleting the temporary source", async () => {
    const sourceKey = "temp/user-1/source.jpg";
    const destinationKey = "recipes/covers/recipe-1/photo.jpg";
    const { env, bucket } = createEnv(
      createBucket({
        [sourceKey]: { bytes: bytes(1, 2, 3), contentType: "image/jpeg" },
      }),
    );

    const result = await createService(env).move(
      [{ from: sourceKey, to: destinationKey }],
      "user-1",
    );

    expect(result).toMatchObject({
      success: true,
      results: [
        {
          from: sourceKey,
          to: destinationKey,
          success: true,
          asset: {
            key: destinationKey,
            publicUrl: `https://images.example.com/${destinationKey}`,
            contentType: "image/jpeg",
            width: 640,
            height: 480,
          },
        },
      ],
    });
    expect(bucket.put).toHaveBeenCalledWith(
      destinationKey,
      expect.any(ReadableStream),
      expect.objectContaining({
        httpMetadata: { contentType: "image/jpeg" },
      }),
    );
    expect(bucket.delete).toHaveBeenCalledWith(sourceKey);
    expect(bucket.records.has(sourceKey)).toBe(false);
    expect(bucket.records.has(destinationKey)).toBe(true);
  });

  it("does not report a committed move as failed when source cleanup fails", async () => {
    const sourceKey = "temp/user-1/source.jpg";
    const { env, bucket } = createEnv(
      createBucket({
        [sourceKey]: { bytes: bytes(1), contentType: "image/jpeg" },
      }),
    );
    bucket.delete.mockRejectedValueOnce(new Error("R2 delete failed"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await createService(env).move(
      [{ from: sourceKey, to: "avatars/user-1.jpg" }],
      "user-1",
    );

    expect(result.success).toBe(true);
    expect(result.results[0]).toMatchObject({ success: true });
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('"event":"image_move_source_cleanup_failed"'),
    );
  });

  it("uses upload-kind size limits when creating presigned URLs", async () => {
    mocks.generatePresignedUploadUrl.mockImplementation(
      async (_env, input) => ({
        uploadUrl: "https://r2.example.com/upload",
        publicUrl: `https://images.example.com/${input.key}`,
        key: input.key,
        maxFileSize: input.maxFileSize,
      }),
    );
    const { env } = createEnv();
    const service = createService(env);

    const avatar = await service.presign("image/png", "user-1", "avatar");
    const importSource = await service.presign(
      "image/png",
      "user-1",
      "recipe_import_source",
    );

    expect(avatar).toMatchObject({ kind: "avatar", maxFileSize: 512 * 1024 });
    expect(avatar.key).toMatch(/^temp\/user-1\/.+\.jpg$/);
    expect(importSource).toMatchObject({
      kind: "recipe_import_source",
      maxFileSize: 10 * 1024 * 1024,
    });
    expect(importSource.key).toMatch(/^temp\/user-1\/.+\.png$/);
  });

  it("blocks private image hosts and private redirect targets", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: "http://127.0.0.1/private.jpg" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { env } = createEnv();
    const service = createService(env);

    await expect(
      service.uploadFromUrl(
        "http://192.168.1.10/image.jpg",
        "social/instagram/private.jpg",
      ),
    ).resolves.toEqual({
      success: false,
      error: "This image host is not supported",
    });
    await expect(
      service.uploadFromUrl(
        "https://cdn.example.com/image.jpg",
        "social/instagram/redirect.jpg",
      ),
    ).resolves.toEqual({
      success: false,
      error: "This image host is not supported",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rehosts a valid bounded remote image with inspected metadata", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(bytes(4, 5, 6), {
          headers: { "Content-Type": "image/jpeg; charset=binary" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { env, bucket } = createEnv();

    const result = await createService(env).uploadFromUrl(
      "https://cdn.example.com/image.jpg",
      "social/instagram/remote.jpg",
    );

    expect(result).toMatchObject({
      success: true,
      publicUrl: "https://images.example.com/social/instagram/remote.jpg",
      key: "social/instagram/remote.jpg",
      asset: {
        byteSize: 3,
        contentType: "image/jpeg",
        thumbhash: "test-thumbhash",
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bucket.put).toHaveBeenCalledWith(
      "social/instagram/remote.jpg",
      expect.any(ArrayBuffer),
      { httpMetadata: { contentType: "image/jpeg" } },
    );
  });

  it("rejects unsupported and oversized trusted uploads before storage", async () => {
    const { env, bucket, transformer } = createEnv();
    const service = createService(env);

    await expect(
      service.uploadImage(bytes(1), "image/gif" as never),
    ).resolves.toEqual({ success: false, error: "Invalid content type" });
    await expect(
      service.uploadImage(new ArrayBuffer(10 * 1024 * 1024 + 1), "image/jpeg"),
    ).resolves.toEqual({
      success: false,
      error: `Image too large: ${10 * 1024 * 1024 + 1} bytes (max ${10 * 1024 * 1024})`,
    });
    expect(transformer.binding.input).not.toHaveBeenCalled();
    expect(bucket.put).not.toHaveBeenCalled();
  });
});
