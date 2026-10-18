import { afterEach, describe, expect, it, vi } from "vitest";

import { getSocialPlatform } from "../../../src/import/social";
import {
  extractRedditContent,
  hasRedditRecipeEvidence,
  normalizeRedditUrl,
  parseRedditJson,
} from "../../../src/import/social/reddit";
import { redditAudioUrl } from "../../../src/import/social/reddit-media";
import {
  comment,
  listing,
  postUrl,
  redditPost,
  redditFeed,
  writtenRecipe,
} from "../../fixtures/reddit";

afterEach(() => vi.unstubAllGlobals());

describe("Reddit sources", () => {
  it.each([
    postUrl,
    "http://old.reddit.com/r/recipes/comments/abc123/title/?utm_source=share",
    "https://m.reddit.com/comments/abc123/",
    "https://redd.it/abc123",
    "https://www.reddit.com/gallery/abc123",
  ])("recognises and normalises %s", (url) => {
    expect(getSocialPlatform(url)).toBe("reddit");
    expect(normalizeRedditUrl(url)).toBe(
      "https://www.reddit.com/comments/abc123/",
    );
  });

  it.each([
    "https://www.reddit.com/r/recipes/",
    "https://www.reddit.com/user/chef/",
    "https://reddit.com.evil.test/comments/abc123/",
    "https://user:password@reddit.com/comments/abc123/",
    "https://reddit.com:8000/comments/abc123/",
    "https://i.redd.it/abc123",
  ])("rejects unsupported input %s", (url) => {
    expect(() => normalizeRedditUrl(url)).toThrow();
  });

  it("preserves a specifically shared comment", () => {
    const url = `${postUrl}recipe1/?context=3`;
    expect(normalizeRedditUrl(url)).toBe(
      "https://www.reddit.com/comments/abc123/_/recipe1/",
    );
    const result = parseRedditJson(
      redditPost({}, [
        comment({ author: "anothercook" }),
        comment({ id: "other", body: "unrelated" }),
      ]),
      url,
    );
    expect(result.body).toBe("");
    expect(result.comments).toEqual([writtenRecipe]);
  });

  it("reads author recipes in nested replies and excludes other users and other posts", () => {
    const result = parseRedditJson(
      redditPost({ selftext: "Recipe in the comments" }, [
        comment({ author: "AutoModerator", body: "Please include a recipe" }),
        comment({
          id: "question",
          author: "reader",
          body: "Recipe?",
          replies: listing([comment()]),
        }),
        comment({ id: "unrelated", link_id: "t3_other", body: "Wrong recipe" }),
      ]),
      postUrl,
    );
    expect(result.comments).toEqual([writtenRecipe]);
  });

  it("accepts a Spotlight copy when the original recipe is outside the comment window", () => {
    const spotlight = comment({
      id: "spotlight",
      author: "spotlight-app",
      stickied: true,
      body: `OP has pinned a [comment](${postUrl}recipe1/) by u/testcook:\n\n${writtenRecipe
        .split("\n")
        .map((line) => `> ${line}`)
        .join(
          "\n",
        )}\n\n[What is Spotlight?](https://developers.reddit.com/apps/spotlight-app)`,
    });
    expect(
      parseRedditJson(redditPost({ selftext: "" }, [spotlight]), postUrl)
        .comments,
    ).toEqual([writtenRecipe]);
    expect(
      parseRedditJson(
        redditPost({ selftext: "" }, [spotlight, comment()]),
        postUrl,
      ).comments,
    ).toEqual([writtenRecipe]);
  });

  it("rejects unrelated Spotlight links and unpinned copies", () => {
    const body = `OP has pinned a [comment](https://reddit.com/comments/other/_/recipe1/)\n> ${writtenRecipe}`;
    expect(
      parseRedditJson(
        redditPost({}, [
          comment({ author: "spotlight-app", stickied: true, body }),
        ]),
        postUrl,
      ).comments,
    ).toEqual([]);
  });

  it("keeps gallery order, captions, and source links while ignoring unrelated media", () => {
    const result = parseRedditJson(
      redditPost({
        selftext: "",
        gallery_data: {
          items: [
            {
              media_id: "page2",
              caption: "Ingredients",
              outbound_url: "https://food.example/recipe",
            },
            { media_id: "page1", caption: "Method" },
          ],
        },
        media_metadata: {
          page1: {
            status: "valid",
            e: "Image",
            s: { u: "https://i.redd.it/first.jpg" },
          },
          page2: {
            status: "valid",
            e: "Image",
            s: {
              u: "https://preview.redd.it/second.png?width=1080&amp;format=png",
            },
          },
          unrelated: {
            status: "valid",
            e: "Image",
            s: { u: "http://127.0.0.1/private.jpg" },
          },
        },
      }),
      postUrl,
    );
    expect(result.images).toEqual([
      "https://preview.redd.it/second.png?width=1080&format=png",
      "https://i.redd.it/first.jpg",
    ]);
    expect(result.body).toContain("https://food.example/recipe");
    expect(result.body).toContain("Method");
  });

  it("reads a recipe photo attached to an author comment", () => {
    const result = parseRedditJson(
      redditPost({ selftext: "" }, [
        comment({
          body: "![img](card1)",
          media_metadata: {
            card1: {
              e: "Image",
              status: "valid",
              s: { u: "https://i.redd.it/card.jpg" },
            },
          },
        }),
      ]),
      postUrl,
    );
    expect(result.images).toEqual(["https://i.redd.it/card.jpg"]);
  });

  it.each([
    { id: "other" },
    { selftext: "[deleted]" },
    { removed_by_category: "moderator" },
  ])("rejects unavailable or mismatched post %j", (overrides) => {
    expect(() => parseRedditJson(redditPost(overrides), postUrl)).toThrow();
  });

  it("accepts recipe prose without headings or quantities", () => {
    expect(
      hasRedditRecipeEvidence(
        "Stuff a tortilla with spinach. Fry until crispy, then drizzle with lemon.",
      ),
    ).toBe(true);
    expect(hasRedditRecipeEvidence("What is your favourite soup recipe?")).toBe(
      false,
    );
  });

  it("accepts Markdown ingredient headings and preserves Unicode fractions", () => {
    const body = "## **Ingredients**\n½ tsp salt\n¼ cup water\nMix together.";
    const result = parseRedditJson(redditPost({ selftext: body }), postUrl);
    expect(result.body).toBe(body);
    expect(hasRedditRecipeEvidence(result.body)).toBe(true);
  });

  it("does not enrich a specifically shared comment with the parent post's video", () => {
    const result = parseRedditJson(
      redditPost(
        {
          secure_media: {
            reddit_video: {
              dash_url: "https://v.redd.it/video1/DASHPlaylist.mpd",
            },
          },
        },
        [comment()],
      ),
      `${postUrl}recipe1/`,
    );
    expect(result.videoManifestUrl).toBeNull();
  });

  it("resolves an app share link within Reddit before requesting the post", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: postUrl } }),
      )
      .mockResolvedValueOnce(new Response(redditFeed()));
    vi.stubGlobal("fetch", fetch);
    expect(
      (
        await extractRedditContent(
          "https://www.reddit.com/r/recipes/s/Share123?utm_source=share",
        )
      ).id,
    ).toBe("abc123");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[1]?.[0])).toContain(
      "/comments/abc123/.rss?limit=100&sort=old",
    );
  });

  it.each([
    "http://127.0.0.1/private",
    "https://evil.test/post",
    "https://www.reddit.com/login",
  ])("rejects share redirects to %s", async (location) => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { location } }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(
      extractRedditContent("https://www.reddit.com/r/recipes/s/Share123"),
    ).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("bounds looping share redirects", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "/r/recipes/s/Share123" },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(
      extractRedditContent("https://www.reddit.com/r/recipes/s/Share123"),
    ).rejects.toThrow(/too many redirects/);
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it("selects audio from a Reddit DASH manifest without fetching arbitrary hosts", () => {
    const manifest =
      '<MPD><Period><AdaptationSet mimeType="video/mp4"><Representation><BaseURL>DASH_720.mp4</BaseURL></Representation></AdaptationSet><AdaptationSet mimeType="audio/mp4"><Representation bandwidth="128000"><BaseURL>DASH_AUDIO_128.mp4</BaseURL></Representation></AdaptationSet></Period></MPD>';
    expect(
      redditAudioUrl(manifest, "https://v.redd.it/video1/DASHPlaylist.mpd"),
    ).toBe("https://v.redd.it/video1/DASH_AUDIO_128.mp4");
    expect(
      redditAudioUrl(
        manifest.replace("DASH_AUDIO_128.mp4", "https://evil.test/audio.mp4"),
        "https://v.redd.it/video1/DASHPlaylist.mpd",
      ),
    ).toBeNull();
  });
});
