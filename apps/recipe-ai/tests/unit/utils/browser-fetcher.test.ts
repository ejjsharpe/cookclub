import puppeteer from "@cloudflare/puppeteer";
import { describe, expect, it, vi } from "vitest";

import {
  fetchHtmlWithBrowser,
  requiresBrowserRendering,
} from "../../../src/utils/browser-fetcher";

vi.mock("@cloudflare/puppeteer", () => ({
  default: {
    launch: vi.fn(),
  },
}));

describe("browser-fetcher", () => {
  it("fetches rendered HTML with the browser binding", async () => {
    const close = vi.fn();
    const page = {
      setUserAgent: vi.fn(),
      setViewport: vi.fn(),
      goto: vi.fn(),
      $: vi.fn().mockResolvedValue(null),
      content: vi.fn().mockResolvedValue("<html><body>Recipe</body></html>"),
    };

    (puppeteer.launch as any).mockResolvedValue({
      newPage: vi.fn().mockResolvedValue(page),
      close,
    });

    const html = await fetchHtmlWithBrowser(
      { id: "browser-binding" } as any,
      "https://www.youtube.com/watch?v=abc123",
    );

    expect(html).toBe("<html><body>Recipe</body></html>");
    expect(page.goto).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=abc123",
      expect.objectContaining({ waitUntil: "domcontentloaded" }),
    );
    expect(close).toHaveBeenCalled();
  });

  it("identifies URLs that use browser rendering in the URL parser", () => {
    expect(
      requiresBrowserRendering("https://www.youtube.com/watch?v=abc"),
    ).toBe(true);
    expect(requiresBrowserRendering("https://example.com/recipe")).toBe(false);
  });
});
