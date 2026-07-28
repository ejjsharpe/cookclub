import puppeteer from "@cloudflare/puppeteer";
import { describe, expect, it, vi } from "vitest";

import {
  fetchHtmlWithBrowser,
  requiresBrowserRendering,
} from "../../../src/import/url/browser";

vi.mock("@cloudflare/puppeteer", () => ({
  default: {
    launch: vi.fn(),
  },
}));

describe("browser-fetcher", () => {
  it("fetches rendered HTML with the browser binding", async () => {
    const close = vi.fn();
    const on = vi.fn();
    const page = {
      setUserAgent: vi.fn(),
      setViewport: vi.fn(),
      setRequestInterception: vi.fn(),
      on,
      goto: vi.fn(),
      url: vi.fn().mockReturnValue("https://www.youtube.com/watch?v=abc123"),
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
    expect(page.setRequestInterception).toHaveBeenCalledWith(true);
    expect(on).toHaveBeenCalledWith("request", expect.any(Function));
    expect(close).toHaveBeenCalled();
  });

  it("identifies URLs that use browser rendering in the URL parser", () => {
    expect(
      requiresBrowserRendering("https://www.youtube.com/watch?v=abc"),
    ).toBe(true);
    expect(requiresBrowserRendering("https://example.com/recipe")).toBe(false);
  });

  it("rejects a browser navigation that redirects to a blocked host", async () => {
    const close = vi.fn();
    const page = {
      setUserAgent: vi.fn(),
      setViewport: vi.fn(),
      setRequestInterception: vi.fn(),
      on: vi.fn(),
      goto: vi.fn(),
      url: vi.fn().mockReturnValue("http://127.0.0.1/private"),
      $: vi.fn(),
      content: vi.fn(),
    };
    (puppeteer.launch as any).mockResolvedValue({
      newPage: vi.fn().mockResolvedValue(page),
      close,
    });

    await expect(
      fetchHtmlWithBrowser(
        { id: "browser-binding" } as any,
        "https://www.youtube.com/watch?v=abc123",
      ),
    ).rejects.toThrow();
    expect(page.content).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it("rejects rendered HTML larger than the parser boundary", async () => {
    const close = vi.fn();
    const page = {
      setUserAgent: vi.fn(),
      setViewport: vi.fn(),
      setRequestInterception: vi.fn(),
      on: vi.fn(),
      goto: vi.fn(),
      url: vi.fn().mockReturnValue("https://www.youtube.com/watch?v=abc123"),
      $: vi.fn().mockResolvedValue(null),
      content: vi.fn().mockResolvedValue("x".repeat(2 * 1024 * 1024 + 1)),
    };
    (puppeteer.launch as any).mockResolvedValue({
      newPage: vi.fn().mockResolvedValue(page),
      close,
    });

    await expect(
      fetchHtmlWithBrowser(
        { id: "browser-binding" } as any,
        "https://www.youtube.com/watch?v=abc123",
      ),
    ).rejects.toThrow("HTML response too large");
    expect(close).toHaveBeenCalled();
  });
});
