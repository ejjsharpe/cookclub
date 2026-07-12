import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  extractInstagramCrawlerContent,
  extractInstagramContent,
  normalizeInstagramUrl,
  extractShortcode,
} from "../../../src/utils/instagram-fetcher";

describe("instagram-fetcher", () => {
  describe("normalizeInstagramUrl", () => {
    it("should remove query parameters", () => {
      const url =
        "https://www.instagram.com/reel/ABC123/?igsh=MWtuYWxyODkyZDQ0dA==";
      expect(normalizeInstagramUrl(url)).toBe(
        "https://www.instagram.com/reel/ABC123/",
      );
    });

    it("should add trailing slash", () => {
      const url = "https://www.instagram.com/reel/ABC123";
      expect(normalizeInstagramUrl(url)).toBe(
        "https://www.instagram.com/reel/ABC123/",
      );
    });

    it("should convert /reels/ to /reel/", () => {
      const url = "https://www.instagram.com/reels/ABC123/";
      expect(normalizeInstagramUrl(url)).toBe(
        "https://www.instagram.com/reel/ABC123/",
      );
    });

    it("should handle /p/ posts", () => {
      const url = "https://www.instagram.com/p/ABC123?utm_source=test";
      expect(normalizeInstagramUrl(url)).toBe(
        "https://www.instagram.com/p/ABC123/",
      );
    });
  });

  describe("extractShortcode", () => {
    it("should extract shortcode from reel URL", () => {
      expect(
        extractShortcode("https://www.instagram.com/reel/DTXVlH2DPub/"),
      ).toBe("DTXVlH2DPub");
    });

    it("should extract shortcode from post URL", () => {
      expect(extractShortcode("https://www.instagram.com/p/ABC123/")).toBe(
        "ABC123",
      );
    });

    it("should extract shortcode from URL with query params", () => {
      expect(
        extractShortcode("https://www.instagram.com/reel/ABC123/?igsh=test123"),
      ).toBe("ABC123");
    });

    it("should return null for invalid URLs", () => {
      expect(extractShortcode("https://www.instagram.com/username/")).toBe(
        null,
      );
    });
  });

  describe("extractInstagramContent", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("should extract content via oembed API", async () => {
      const mockResponse = {
        title: "Test recipe caption with ingredients and instructions",
        author_name: "testuser",
        author_url: "https://www.instagram.com/testuser",
        thumbnail_url: "https://example.com/thumb.jpg",
      };

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await extractInstagramContent(
        "https://www.instagram.com/reel/ABC123/",
      );

      expect(result.caption).toBe(mockResponse.title);
      expect(result.authorName).toBe("testuser");
      expect(result.images).toContain("https://example.com/thumb.jpg");
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("instagram.com/api/v1/oembed"),
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        }),
      );
    });

    it("should throw error on API failure", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      await expect(
        extractInstagramContent("https://www.instagram.com/reel/ABC123/"),
      ).rejects.toThrow("Instagram oembed API returned 404");
    });

    it("should handle null caption", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ author_name: "testuser" }),
      });

      const result = await extractInstagramContent(
        "https://www.instagram.com/reel/ABC123/",
      );

      expect(result.caption).toBe(null);
      expect(result.images).toEqual([]);
    });
  });

  describe("extractInstagramCrawlerContent", () => {
    it("selects a creator recipe comment from the public crawler payload", async () => {
      const payload = {
        result: {
          data: {
            xig_polaris_media: {
              if_not_gated_logged_out: {
                code: "ABC123",
                pk: "123456",
                user: { username: "recipe_creator" },
                caption: { text: "Pasta ingredients. Full recipe in comments" },
                display_uri: "https://example.com/crawler-cover.jpg",
              },
              comments_connection: {
                edges: [
                  {
                    node: {
                      __typename: "XIGComment",
                      text: "PASTA",
                      user: { username: "viewer" },
                      comment_like_count: 0,
                    },
                  },
                  {
                    node: {
                      __typename: "XIGComment",
                      text: "Instructions: Boil the pasta, simmer the sauce, then stir together for 2 minutes.",
                      user: { username: "recipe_creator" },
                      comment_like_count: 12,
                    },
                  },
                ],
              },
            },
          },
        },
      };
      const html = `<html><body><script type="application/json">${JSON.stringify(
        payload,
      )}</script></body></html>`;

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          "content-type": "text/html",
          "content-length": String(new TextEncoder().encode(html).byteLength),
        }),
        arrayBuffer: () =>
          Promise.resolve(new TextEncoder().encode(html).buffer),
      });

      const result = await extractInstagramCrawlerContent(
        "https://www.instagram.com/reel/ABC123/",
      );

      expect(result.caption).toContain("Full recipe in comments");
      expect(result.authorName).toBe("recipe_creator");
      expect(result.images).toEqual(["https://example.com/crawler-cover.jpg"]);
      expect(result.comments).toEqual([
        expect.objectContaining({
          username: "recipe_creator",
          isCreator: true,
          text: expect.stringContaining("Boil the pasta"),
        }),
      ]);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://www.instagram.com/reel/ABC123/",
        expect.objectContaining({
          redirect: "manual",
          headers: expect.objectContaining({
            "User-Agent": expect.stringContaining("Googlebot"),
          }),
        }),
      );
    });

    it("rejects oversized crawler pages", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": "2000000" }),
      });

      await expect(
        extractInstagramCrawlerContent(
          "https://www.instagram.com/reel/ABC123/",
        ),
      ).rejects.toThrow("HTML response too large");
    });
  });
});
