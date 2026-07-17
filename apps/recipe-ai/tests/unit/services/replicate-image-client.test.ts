import { afterEach, describe, expect, it, vi } from "vitest";

import { generateReplicateImage } from "../../../src/services/replicate-image-client";

describe("Replicate image client", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("generates and downloads a bounded JPEG synchronously", async () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          id: "prediction-id",
          status: "succeeded",
          output: ["https://replicate.delivery/pbxt/prediction-id/output.jpg"],
          urls: {
            get: "https://api.replicate.com/v1/predictions/prediction-id",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(jpeg, {
          headers: {
            "Content-Length": String(jpeg.byteLength),
            "Content-Type": "image/jpeg",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateReplicateImage({
        apiToken: "replicate-token",
        prompt: "Food photography of tomato pasta",
        seed: 42,
      }),
    ).resolves.toEqual(jpeg.buffer);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [submitUrl, submitInit] = fetchMock.mock.calls[0]!;
    expect(submitUrl).toBe(
      "https://api.replicate.com/v1/models/black-forest-labs/flux-2-klein-4b/predictions",
    );
    const submitHeaders = new Headers(submitInit?.headers);
    expect(submitInit?.redirect).toBe("manual");
    expect(submitHeaders.get("authorization")).toBe("Bearer replicate-token");
    expect(submitHeaders.get("prefer")).toBe("wait=60");
    expect(JSON.parse(String(submitInit?.body))).toEqual({
      input: {
        prompt: "Food photography of tomato pasta",
        seed: 42,
        aspect_ratio: "1:1",
        output_megapixels: "1",
        go_fast: true,
        output_format: "jpg",
        output_quality: 95,
      },
    });
    const downloadHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
    expect(fetchMock.mock.calls[1]?.[1]?.redirect).toBe("manual");
    expect(downloadHeaders.get("authorization")).toBe("Bearer replicate-token");
  });

  it("polls when the synchronous response is still processing", async () => {
    vi.useFakeTimers();
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          id: "prediction-id",
          status: "processing",
          output: null,
          urls: {
            get: "https://api.replicate.com/v1/predictions/prediction-id",
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "prediction-id",
          status: "processing",
          output: ["https://pbxt.replicate.delivery/prediction-id/output.jpg"],
        }),
      )
      .mockResolvedValueOnce(
        new Response(jpeg, {
          headers: { "Content-Type": "image/jpeg" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = generateReplicateImage({
      apiToken: "replicate-token",
      prompt: "Pasta",
      seed: 1,
    });
    await vi.advanceTimersByTimeAsync(500);
    await expect(resultPromise).resolves.toEqual(jpeg.buffer);

    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://api.replicate.com/v1/predictions/prediction-id",
    );
    expect(fetchMock.mock.calls[1]?.[1]?.redirect).toBe("manual");
  });

  it("surfaces prediction failures", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        id: "prediction-id",
        status: "failed",
        output: null,
        error: "The prompt was rejected",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateReplicateImage({
        apiToken: "replicate-token",
        prompt: "Pasta",
        seed: 1,
      }),
    ).rejects.toThrow(
      "Replicate image generation failed: The prompt was rejected",
    );
  });

  it("rejects provider-controlled URLs outside Replicate", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        id: "prediction-id",
        status: "processing",
        output: null,
        urls: { get: "https://example.com/steal-token" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateReplicateImage({
        apiToken: "replicate-token",
        prompt: "Pasta",
        seed: 1,
      }),
    ).rejects.toThrow("Replicate returned an untrusted api URL");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not call Replicate when its token is missing", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateReplicateImage({ apiToken: "", prompt: "Pasta", seed: 1 }),
    ).rejects.toThrow("REPLICATE_API_TOKEN is required");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
