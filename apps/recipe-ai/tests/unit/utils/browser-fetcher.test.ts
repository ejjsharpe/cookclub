import puppeteer from "@cloudflare/puppeteer";
import { describe, expect, it, vi } from "vitest";

import { extractInstagramContent } from "../../../src/utils/browser-fetcher";

vi.mock("@cloudflare/puppeteer", () => ({
  default: {
    launch: vi.fn(),
  },
}));

describe("browser-fetcher", () => {
  it("extracts Instagram captions, images, video URLs, and frame images", async () => {
    vi.useFakeTimers();

    const close = vi.fn();
    const page = {
      setUserAgent: vi.fn(),
      setViewport: vi.fn(),
      goto: vi.fn(),
      waitForSelector: vi.fn(),
      $: vi.fn().mockResolvedValue(null),
      evaluate: vi.fn((script: string) => {
        if (script.includes("return { caption, images, videoUrls }")) {
          return Promise.resolve({
            caption: "Tomato pasta recipe with ingredients and method.",
            images: ["https://cdninstagram.example.com/image.jpg"],
            videoUrls: ["https://cdninstagram.example.com/reel.mp4"],
          });
        }

        return Promise.resolve(undefined);
      }),
      screenshot: vi
        .fn()
        .mockResolvedValue(new Uint8Array([1, 2, 3, 4]).buffer),
      content: vi.fn().mockResolvedValue("<html></html>"),
    };

    (puppeteer.launch as any).mockResolvedValue({
      newPage: vi.fn().mockResolvedValue(page),
      close,
    });

    const resultPromise = extractInstagramContent(
      { id: "browser-binding" } as any,
      "https://www.instagram.com/reel/ABC123/",
    );
    await vi.advanceTimersByTimeAsync(3000);
    const result = await resultPromise;

    expect(result.caption).toBe(
      "Tomato pasta recipe with ingredients and method.",
    );
    expect(result.images).toEqual([
      "https://cdninstagram.example.com/image.jpg",
    ]);
    expect(result.videoUrls).toEqual([
      "https://cdninstagram.example.com/reel.mp4",
    ]);
    expect(result.frameImages).toHaveLength(3);
    expect(Array.from(result.frameImages[0] ?? [])).toEqual([1, 2, 3, 4]);
    expect(close).toHaveBeenCalled();

    vi.useRealTimers();
  });
});
