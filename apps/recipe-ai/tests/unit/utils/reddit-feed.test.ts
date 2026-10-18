import { afterEach, describe, expect, it, vi } from "vitest";

import {
  extractRedditContent,
  parseRedditFeed,
} from "../../../src/import/social/reddit";
import {
  feedEntry,
  postUrl,
  redditFeed,
  reportedPostUrl,
  reportedShareUrl,
  writtenRecipe,
} from "../../fixtures/reddit";

afterEach(() => vi.unstubAllGlobals());

describe("Reddit public feeds", () => {
  it("extracts recipe text, source links and cover images without submission attribution", () => {
    const content = parseRedditFeed(
      redditFeed([
        feedEntry({
          html: '<div class="md"><p>Ingredients:</p><p>½ cup flour &amp; water</p><ol><li>Mix and bake.</li></ol><a href="https://food.example/recipe">Full recipe</a></div> submitted by <a href="https://reddit.com/user/testcook">testcook</a> <a href="https://i.redd.it/bread.jpg">[link]</a>',
          thumbnail: "https://preview.redd.it/bread.jpg?width=320&format=png",
        }),
      ]),
      postUrl,
    );
    expect(content.body).toContain("½ cup flour & water");
    expect(content.body).toContain("- Mix and bake.");
    expect(content.body).not.toMatch(/submitted by|testcook/);
    expect(content.links).toContain("https://food.example/recipe");
    expect(content.images).toEqual([
      "https://preview.redd.it/bread.jpg?width=320&format=png",
      "https://i.redd.it/bread.jpg",
    ]);
    expect(content.canonicalUrl).toBe(postUrl);
  });

  it("selects author comments and excludes other users, mismatched comment IDs and other posts", () => {
    const content = parseRedditFeed(
      redditFeed([
        feedEntry({ html: '<div class="md">Recipe in comments</div>' }),
        feedEntry({ id: "t1_recipe1", url: `${postUrl}recipe1/` }),
        feedEntry({
          id: "t1_reader1",
          url: `${postUrl}reader1/`,
          author: "reader",
          html: '<div class="md">Unrelated recipe</div>',
        }),
        feedEntry({
          id: "t1_forged",
          url: `${postUrl}recipe1/`,
          html: '<div class="md">Mismatched comment</div>',
        }),
        feedEntry({
          id: "t1_wrong",
          url: "https://reddit.com/comments/other/_/wrong/",
          html: '<div class="md">Wrong post</div>',
        }),
        feedEntry({
          id: "t3_other",
          url: "https://reddit.com/comments/other/",
          html: '<div class="md">Recommended recipe</div>',
        }),
      ]),
      postUrl,
    );
    expect(content.comments).toEqual([writtenRecipe]);
    expect(JSON.stringify(content)).not.toMatch(
      /Unrelated recipe|Mismatched comment|Wrong post|Recommended recipe/,
    );
  });

  it("selects an explicitly shared comment without adding parent text, images or links", () => {
    const content = parseRedditFeed(
      redditFeed([
        feedEntry({
          html: '<div class="md">Parent recipe<img src="https://i.redd.it/parent.jpg"></div>',
        }),
        feedEntry({
          id: "t1_recipe1",
          url: `${postUrl}recipe1/`,
          author: "reader",
          html: `<div class="md"><p>${writtenRecipe}</p><img src="https://i.redd.it/comment.jpg"><img src="http://127.0.0.1/private.jpg"></div>`,
        }),
      ]),
      `${postUrl}recipe1/`,
    );
    expect(content.body).toBe("");
    expect(content.links).toEqual([]);
    expect(content.comments).toEqual([writtenRecipe]);
    expect(content.images).toEqual(["https://i.redd.it/comment.jpg"]);
    expect(content.canonicalUrl).toBe(
      "https://www.reddit.com/comments/abc123/_/recipe1/",
    );
  });

  it.each([
    redditFeed([]),
    redditFeed([feedEntry({ id: "t3_other" })]),
    redditFeed([feedEntry({ url: "https://evil.test/comments/abc123/" })]),
    redditFeed([feedEntry({ html: '<div class="md">[removed]</div>' })]),
    redditFeed([feedEntry({ html: '<div class="md">[deleted]</div>' })]),
  ])("rejects missing, deleted or mismatched posts", (feed) => {
    expect(() => parseRedditFeed(feed, postUrl)).toThrow();
  });

  it("rejects a missing specifically shared comment", () => {
    expect(() => parseRedditFeed(redditFeed(), `${postUrl}missing/`)).toThrow(
      /comment is unavailable/,
    );
  });

  it("resolves the reported share link and requests its public feed directly", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 301,
          headers: { location: `${reportedPostUrl}?utm_source=share` },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          redditFeed([feedEntry({ id: "t3_1x71123", url: reportedPostUrl })]),
        ),
      );
    vi.stubGlobal("fetch", fetch);
    const content = await extractRedditContent(reportedShareUrl);
    expect(content.id).toBe("1x71123");
    expect(content.body).toBe(writtenRecipe);
    expect(content.canonicalUrl).toBe(reportedPostUrl);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]?.[0]).toBe(
      "https://www.reddit.com/comments/1x71123/.rss?limit=100&sort=old",
    );
  });

  it.each([
    { status: 403, body: "blocked" },
    {
      status: 200,
      body: '<html><form><input name="js_challenge" value="1"></form></html>',
    },
  ])(
    "stops when the feed is unavailable ($status), without JSON, HTML or browser retries",
    async ({ status, body }) => {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(new Response(body, { status }));
      vi.stubGlobal("fetch", fetch);
      await expect(extractRedditContent(postUrl)).rejects.toThrow();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0]?.[0]).toBe(
        "https://www.reddit.com/comments/abc123/.rss?limit=100&sort=old",
      );
    },
  );

  it("follows a feed redirect only to the same post", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: `${postUrl}.rss` },
        }),
      )
      .mockResolvedValueOnce(new Response(redditFeed()));
    vi.stubGlobal("fetch", fetch);
    expect((await extractRedditContent(postUrl)).body).toBe(writtenRecipe);
    expect(fetch.mock.calls[1]?.[0]).toBe(`${postUrl}.rss`);
  });

  it.each([
    "https://evil.test/comments/abc123/.rss",
    "http://127.0.0.1/comments/abc123/.rss",
    "https://www.reddit.com/comments/other/.rss",
    "https://www.reddit.com/login",
    `${postUrl}other/.rss`,
  ])("rejects an unsafe or different feed redirect to %s", async (location) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location } }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(extractRedditContent(postUrl)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("bounds looping feed redirects", async () => {
    const fetch = vi.fn().mockImplementation(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: `${postUrl}.rss` },
        }),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(extractRedditContent(postUrl)).rejects.toThrow(
      /too many redirects/,
    );
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it("rejects oversized feeds before parsing", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("x".repeat(2 * 1024 * 1024 + 1))),
    );
    await expect(extractRedditContent(postUrl)).rejects.toThrow(
      /too large|exceeded/i,
    );
  });

  it.each<{ headers: Record<string, string>; delay: number | undefined }>([
    { headers: { "x-ratelimit-reset": "20" }, delay: 20 },
    { headers: { "x-ratelimit-reset": "20", "retry-after": "30" }, delay: 30 },
    { headers: { "x-ratelimit-reset": "invalid" }, delay: undefined },
  ])(
    "preserves feed rate limits without trying another endpoint ($delay)",
    async ({ headers, delay }) => {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(new Response("", { status: 429, headers }));
      vi.stubGlobal("fetch", fetch);
      await expect(extractRedditContent(postUrl)).rejects.toMatchObject({
        status: 429,
        retryable: true,
        retryAfterSeconds: delay,
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
});
