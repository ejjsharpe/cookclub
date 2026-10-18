import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  extractRedditContent,
  parseRedditGalleryEmbed,
} from "../../../src/import/social/reddit";
import {
  feedEntry,
  galleryPostUrl as postUrl,
  galleryShareUrl,
  redditFeed,
  writtenRecipe,
} from "../../fixtures/reddit";

const embed = readFileSync(
  new URL("../../fixtures/reddit-gallery-embed.html", import.meta.url),
  "utf8",
);
const galleryUrl = "https://www.reddit.com/gallery/1x8sssh";
const embedUrl = postUrl.replace("www.reddit.com", "embed.reddit.com");
const images = parseRedditGalleryEmbed(embed, postUrl);

function galleryFeed() {
  return redditFeed([
    feedEntry({
      id: "t3_1x8sssh",
      url: postUrl,
      html: `<div class="md"><p>${writtenRecipe}</p></div><a href="${galleryUrl}">[link]</a>`,
    }),
  ]);
}

afterEach(() => vi.unstubAllGlobals());

describe("Reddit gallery embed image recovery", () => {
  it("reads the reported gallery's captured embed with sibling handler and carousel", () => {
    expect(images).toHaveLength(3);
    expect(images[0]).toContain("mlya5a9x85wh1.jpg");
    expect(images[1]).toContain("uprl0tix85wh1.jpg");
    expect(images[2]).toContain("emvdm5rx85wh1.jpg");
  });

  it("rejects mismatched identity, gallery, wrapper and comment embeds", () => {
    for (const html of [
      embed.replace('post-id="t3_1x8sssh"', 'post-id="t3_other"'),
      embed.replace(
        'id="t3_1x8sssh-embed-wrapper"',
        'id="t3_other-embed-wrapper"',
      ),
      embed.replace(
        `link="${postUrl}"`,
        'link="https://www.reddit.com/comments/other/"',
      ),
      "<html><body>Please log in</body></html>",
    ]) {
      expect(parseRedditGalleryEmbed(html, postUrl)).toEqual([]);
    }
    expect(parseRedditGalleryEmbed(embed, `${postUrl}comment1/`)).toEqual([]);
  });

  it("ignores images outside the selected gallery and disallowed image hosts", () => {
    const html = embed
      .replace(
        "<gallery-carousel",
        '<img src="https://i.redd.it/avatar.jpg"><gallery-carousel',
      )
      .replace(
        "</gallery-carousel>",
        '<img src="https://evil.test/private.jpg"><img src="http://127.0.0.1/private.jpg"></gallery-carousel>',
      );
    expect(parseRedditGalleryEmbed(html, postUrl)).toEqual(images);
    expect(
      parseRedditGalleryEmbed(
        embed.replaceAll("https://preview.redd.it/", "https://evil.test/"),
        postUrl,
      ),
    ).toEqual([]);
  });

  it.each([
    postUrl,
    postUrl.replace(/\/$/, ""),
    `${postUrl}?utm_source=share#recipe`,
    "https://redd.it/1x8sssh",
    galleryShareUrl,
  ])("extracts the same recipe and gallery images from %s", async (url) => {
    const fetch = vi.fn();
    const isShare = url === galleryShareUrl;
    if (isShare) {
      fetch.mockResolvedValueOnce(
        new Response(null, { status: 301, headers: { location: postUrl } }),
      );
    }
    fetch
      .mockResolvedValueOnce(new Response(galleryFeed()))
      .mockResolvedValueOnce(new Response(embed));
    vi.stubGlobal("fetch", fetch);
    const result = await extractRedditContent(url);
    expect(result).toMatchObject({
      representation: "feed",
      id: "1x8sssh",
      canonicalUrl: postUrl,
      galleryImageRecovery: "recovered",
      body: writtenRecipe,
      images,
    });
    const feedIndex = isShare ? 1 : 0;
    expect(fetch).toHaveBeenCalledTimes(feedIndex + 2);
    expect(fetch.mock.calls[feedIndex]?.[0]).toBe(
      "https://www.reddit.com/comments/1x8sssh/.rss?limit=100&sort=old",
    );
    expect(fetch.mock.calls[feedIndex + 1]?.[0]).toBe(embedUrl);
    expect(fetch.mock.calls[feedIndex + 1]?.[1]).toMatchObject({
      redirect: "manual",
    });
  });

  it.each([
    "blocked",
    "rate-limited",
    "redirect",
    "oversized",
    "timeout",
    "wrong-post",
  ])(
    "preserves a usable text recipe when optional image recovery is %s",
    async (failure) => {
      const fetch = vi.fn().mockResolvedValueOnce(new Response(galleryFeed()));
      if (failure === "timeout") {
        fetch.mockRejectedValueOnce(
          new DOMException("Timed out", "TimeoutError"),
        );
      } else {
        fetch.mockResolvedValueOnce(
          failure === "blocked"
            ? new Response("blocked", { status: 403 })
            : failure === "rate-limited"
              ? new Response("", { status: 429 })
              : failure === "redirect"
                ? new Response(null, {
                    status: 302,
                    headers: { location: "http://127.0.0.1/private" },
                  })
                : failure === "oversized"
                  ? new Response("x".repeat(2 * 1024 * 1024 + 1))
                  : new Response(embed.replaceAll("1x8sssh", "other")),
        );
      }
      vi.stubGlobal("fetch", fetch);
      expect(await extractRedditContent(postUrl)).toMatchObject({
        body: writtenRecipe,
        images: [],
        galleryImageRecovery: "unavailable",
      });
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );
});
