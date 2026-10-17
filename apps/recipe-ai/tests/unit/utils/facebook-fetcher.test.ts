import { afterEach, describe, expect, it, vi } from "vitest";

import { getSocialPlatform } from "../../../src/import/social";
import {
  extractFacebookContent,
  facebookContentIdentity,
  fetchFacebookMedia,
  hasFacebookRecipeEvidence,
  hasWrittenFacebookRecipe,
  normalizeFacebookUrl,
  parseFacebookHtml,
  parseFacebookSubtitles,
} from "../../../src/import/social/facebook";
import { createSourceSnapshot } from "../../../src/services/source-snapshot";
import {
  accordionPotatoes,
  facebookHtml,
  tomatoSoup,
  wheatThins,
} from "../../fixtures/facebook";

afterEach(() => vi.unstubAllGlobals());

describe("Facebook public content", () => {
  it("does not mistake a pointer to comments for a written method", () => {
    expect(
      hasWrittenFacebookRecipe(
        "Ingredients:\n- flour\n- water\nInstructions in comments",
      ),
    ).toBe(false);
    expect(
      hasWrittenFacebookRecipe(
        "Ingredients:\n- flour\n- water\nInstructions: Mix the flour and water.",
      ),
    ).toBe(true);
  });

  it.each([
    [wheatThins, true],
    [accordionPotatoes, false],
    [tomatoSoup, true],
  ] as const)("reads the selected records for $0.id", (fixture, captions) => {
    const result = parseFacebookHtml(facebookHtml(fixture), fixture.sourceUrl);
    expect(result.id).toBe(fixture.id);
    expect(result.audioUrl).toContain("audio.mp4");
    expect(Boolean(result.captionsUrl)).toBe(captions);
    expect(result.images).toHaveLength(1);
  });

  it("preserves the soup's full caption, sections, quantities and temperature", () => {
    const result = parseFacebookHtml(
      facebookHtml(tomatoSoup),
      tomatoSoup.sourceUrl,
    );
    expect(result.canonicalUrl).toBe(
      "https://www.facebook.com/reel/2504345230068876/",
    );
    expect(result.caption).toContain("5 ripe tomatoes");
    expect(result.caption).toContain("Grilled cheese:");
    expect(result.caption).toContain("350°F (180°C) for 40-50 minutes");
    expect(result.caption).toContain("1-2 cups (240-480 ml) vegetable broth");
    expect(result.caption!.length).toBeGreaterThan(
      tomatoSoup.meta["og:description"].length,
    );
  });

  it("ignores unrelated posts and malformed scripts", () => {
    const html = facebookHtml(wheatThins).replace(
      "</body>",
      '<script type="application/json">broken json</script><script type="application/json">{"id":"9999","message":{"text":"Ingredients: poison soup"},"captions_url":"https://evil.test/file"}</script></body>',
    );
    const content = parseFacebookHtml(html, wheatThins.sourceUrl);
    expect(content.caption).not.toContain("poison");
    expect(content.captionsUrl).toContain("wheat-thins/captions.srt");
  });

  it("rejects a different post's canonical metadata", () => {
    expect(() =>
      parseFacebookHtml(facebookHtml(tomatoSoup), wheatThins.sourceUrl),
    ).toThrow("requested public post");
  });

  it("resolves the requested share link before extracting its post", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: tomatoSoup.meta["og:url"] },
        }),
      )
      .mockResolvedValueOnce(
        new Response(facebookHtml(tomatoSoup), {
          headers: { "content-type": "text/html" },
        }),
      );
    vi.stubGlobal("fetch", fetch);
    expect((await extractFacebookContent(tomatoSoup.sourceUrl)).id).toBe(
      tomatoSoup.id,
    );
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      tomatoSoup.sourceUrl,
      expect.objectContaining({ redirect: "manual" }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      tomatoSoup.meta["og:url"],
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it.each([
    "https://www.facebook.com/login/?next=post",
    "https://127.0.0.1/post",
    "https://facebook.com.evil.test/post",
  ])("rejects unsafe/inaccessible redirects: %s", async (location) => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { location } }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(
      extractFacebookContent(tomatoSoup.sourceUrl),
    ).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects private/deleted pages, excessive redirects and oversized HTML", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html>Log in</html>", {
          headers: { "content-type": "text/html" },
        }),
      ),
    );
    await expect(extractFacebookContent(wheatThins.sourceUrl)).rejects.toThrow(
      "requires login",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: tomatoSoup.sourceUrl },
          }),
        ),
      ),
    );
    await expect(extractFacebookContent(tomatoSoup.sourceUrl)).rejects.toThrow(
      "too many redirects",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("", {
          headers: {
            "content-type": "text/html",
            "content-length": "9999999",
          },
        }),
      ),
    );
    await expect(extractFacebookContent(wheatThins.sourceUrl)).rejects.toThrow(
      "too large",
    );
  });

  it("preserves rate-limit retry information", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("Rate limited", {
          status: 429,
          headers: { "retry-after": "45" },
        }),
      ),
    );
    await expect(
      extractFacebookContent(wheatThins.sourceUrl),
    ).rejects.toMatchObject({ retryable: true, retryAfterSeconds: 45 });
  });
});

describe("Facebook URL identity", () => {
  it.each([
    ["https://m.facebook.com/reel/123/?mibextid=abc", "123", "video"],
    ["https://fb.com/watch/?v=123&ref=share", "123", "video"],
    ["https://www.facebook.com/chef/videos/a-video/123/", "123", "video"],
    ["https://www.facebook.com/chef/posts/pfbidABC123/", "pfbidABC123", "post"],
    [
      "https://www.facebook.com/permalink.php?story_fbid=123&id=456",
      "123",
      "post",
    ],
    ["https://www.facebook.com/groups/456/posts/123/", "123", "post"],
    ["https://www.facebook.com/photo.php?fbid=123&set=456", "123", "photo"],
    ["https://www.facebook.com/chef/photos/a.456/123/", "123", "photo"],
  ])("identifies %s", (url, id, kind) =>
    expect(facebookContentIdentity(url!)).toEqual({ id, kind }),
  );

  it("retains identity parameters and removes tracking", () => {
    expect(
      normalizeFacebookUrl(
        "https://m.facebook.com/story.php?story_fbid=pfbidABC&id=456&mibextid=x#comments",
      ),
    ).toBe("https://www.facebook.com/story.php?id=456&story_fbid=pfbidABC");
  });

  it.each([
    "https://facebook.com/chef/",
    "https://facebook.com/",
    "https://facebook.com/groups/123/",
    "https://facebook.com.evil.test/reel/123/",
    "https://user:pass@facebook.com/reel/123/",
  ])("rejects non-post/invalid input: %s", (url) =>
    expect(() => normalizeFacebookUrl(url)).toThrow(),
  );

  it("keeps fb.watch resolution in the Facebook adapter", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(getSocialPlatform("https://fb.watch/abcdef/")).toBe("facebook");
    expect(
      (await createSourceSnapshot("https://fb.watch/abcdef/")).platform,
    ).toBe("facebook");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Facebook media", () => {
  it("reads recipe SRT and VTT while filtering music-only evidence", () => {
    const transcript = parseFacebookSubtitles(wheatThins.subtitles);
    expect(transcript).toContain("whole wheat flour");
    expect(transcript).not.toContain("-->");
    expect(hasFacebookRecipeEvidence(transcript)).toBe(true);
    expect(
      hasFacebookRecipeEvidence(parseFacebookSubtitles(tomatoSoup.subtitles)),
    ).toBe(false);
    expect(
      parseFacebookSubtitles(
        "WEBVTT\n\nNOTE ignore\n\n00:00:01.000 --> 00:00:02.000\n<b>Stir the flour.</b>\n",
      ),
    ).toBe("Stir the flour.");
    expect(
      hasFacebookRecipeEvidence(
        "Accordion potatoes #recipe #ingredients #quickrecipe",
      ),
    ).toBe(false);
  });

  it("bounds media and refuses redirects off the CDN", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      fetchFacebookMedia("https://evil.test/audio", "audio"),
    ).rejects.toThrow("approved CDN");
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "https://localhost/audio" },
      }),
    );
    await expect(
      fetchFacebookMedia("https://video.xx.fbcdn.net/audio.mp4", "audio"),
    ).rejects.toThrow("redirect");
    fetch.mockResolvedValueOnce(
      new Response("", {
        headers: { "content-type": "audio/mp4", "content-length": "5000000" },
      }),
    );
    await expect(
      fetchFacebookMedia("https://video.xx.fbcdn.net/audio.mp4", "audio"),
    ).rejects.toThrow("too large");
    fetch.mockResolvedValueOnce(
      new Response("<html>Login</html>", {
        headers: { "content-type": "text/html" },
      }),
    );
    await expect(
      fetchFacebookMedia("https://video.xx.fbcdn.net/audio.mp4", "audio"),
    ).rejects.toThrow("media type");
  });
});
