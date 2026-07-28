import { describe, expect, it, vi } from "vitest";

import {
  extractYouTubeVideoId,
  fetchYouTubeComments,
  fetchYouTubeTranscript,
  normalizeYouTubeUrl,
} from "../../../src/import/social/youtube";

describe("youtube-fetcher", () => {
  it("normalizes supported YouTube video URL formats", () => {
    const expected = "abc123DEF_-";

    expect(
      extractYouTubeVideoId(
        "https://www.youtube.com/watch?v=abc123DEF_-&utm_source=share",
      ),
    ).toBe(expected);
    expect(
      extractYouTubeVideoId("https://youtube.com/shorts/abc123DEF_-?si=123"),
    ).toBe(expected);
    expect(
      extractYouTubeVideoId("https://www.youtube.com/embed/abc123DEF_-"),
    ).toBe(expected);
    expect(extractYouTubeVideoId("https://youtu.be/abc123DEF_-?t=30")).toBe(
      expected,
    );
    expect(normalizeYouTubeUrl("https://youtu.be/abc123DEF_-?t=30")).toBe(
      "https://www.youtube.com/watch?v=abc123DEF_-",
    );
  });

  it("scores creator recipe comments ahead of generic comments", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          items: [
            {
              snippet: {
                topLevelComment: {
                  snippet: {
                    textOriginal: "Looks great!",
                    authorDisplayName: "Viewer",
                    authorChannelId: { value: "viewer-1" },
                    likeCount: 100,
                  },
                },
              },
            },
            {
              snippet: {
                topLevelComment: {
                  snippet: {
                    textOriginal:
                      "Ingredients: 200 g pasta, 1 cup sauce. Full recipe: https://example.com/pasta",
                    authorDisplayName: "Cook Channel",
                    authorChannelId: { value: "channel-1" },
                    likeCount: 1,
                  },
                },
              },
            },
          ],
        }),
    });

    const result = await fetchYouTubeComments(
      "test-key",
      "abc123DEF_-",
      "channel-1",
    );

    expect(result.comments[0]?.authorDisplayName).toBe("Cook Channel");
    expect(result.comments[0]?.score).toBeGreaterThan(
      result.comments[1]?.score ?? 0,
    );
  });

  it("extracts usable transcript text from signed caption tracks", async () => {
    global.fetch = vi.fn((requestUrl: string | URL) => {
      const requested = String(requestUrl);
      if (requested === "https://www.youtube.com/watch?v=abc123DEF_-") {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () =>
            Promise.resolve(`
              <script>
                var ytInitialPlayerResponse = ${JSON.stringify({
                  captions: {
                    playerCaptionsTracklistRenderer: {
                      captionTracks: [
                        { baseUrl: "https://captions.example.com/track" },
                      ],
                    },
                  },
                })};
              </script>
            `),
        });
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              events: [
                { segs: [{ utf8: "Add 1 cup flour to a bowl. " }] },
                { segs: [{ utf8: "Whisk with milk and cook until golden." }] },
              ],
            }),
          ),
      });
    }) as any;

    await expect(
      fetchYouTubeTranscript("https://www.youtube.com/watch?v=abc123DEF_-"),
    ).resolves.toBe(
      "Add 1 cup flour to a bowl. Whisk with milk and cook until golden.",
    );
  });
});
