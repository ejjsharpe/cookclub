import { afterEach, describe, expect, it, vi } from "vitest";

import { extractSocialRecipeLinks } from "../../../src/import/social/links";
import {
  extractPinterestContent,
  extractPinterestPinId,
  hasPinterestRecipeEvidence,
  normalizePinterestUrl,
  parsePinterestHtml,
} from "../../../src/import/social/pinterest";
import {
  chiliRoundup,
  pinterestHtml,
  recipePins,
  sharedPastaPin,
} from "../../fixtures/pinterest";

const pinUrl = "https://www.pinterest.com/pin/123/";
afterEach(() => vi.unstubAllGlobals());

describe("Pinterest pin extraction", () => {
  it.each([
    "https://uk.pinterest.com/pin/123/?utm_source=share#recipe",
    "https://www.pinterest.com/pin/spicy-tartar-sauce--123/",
    "http://pinterest.com/pin/123",
    "https://www.pinterest.co.uk/pin/123/sent/?sfo=1",
    "https://uk.pinterest.com/pin/123/sent/",
  ])("normalizes the selected pin %s", (url) => {
    expect(extractPinterestPinId(url)).toBe("123");
    expect(normalizePinterestUrl(url)).toBe(pinUrl);
  });

  it.each([
    "https://uk.pinterest.com/allrecipes/",
    "https://uk.pinterest.com/allrecipes/dinner-ideas/",
    "https://pinterest.com/search/pins/?q=pasta",
    "https://pinterest.com/pin/not-a-pin/",
    "https://pinterest.com.evil.test/pin/123/",
    "https://pinterest.co.uk.evil.test/pin/123/",
    "https://notpinterest.co.uk/pin/123/",
    "https://www.pinterest.co.uk/pin/123/unrelated/",
    "https://pin.it/pin/123/",
    "https://pinterest.com:8443/pin/123/",
    "https://user:password@pinterest.com/pin/123/",
  ])("rejects unsupported source %s", (url) => {
    expect(() => normalizePinterestUrl(url)).toThrow();
  });

  it.each(recipePins)(
    "reads the live Allrecipes metadata for $sourceUrl",
    (fixture) => {
      const pin = parsePinterestHtml(pinterestHtml(fixture), fixture.sourceUrl);
      expect(pin.title).toBe(fixture.structured[0]?.headline);
      expect(extractSocialRecipeLinks(pin.links, pin.canonicalUrl)).toEqual([
        fixture.meta["pinterestapp:source"].split("?")[0],
      ]);
      expect(pin.images).toEqual([fixture.structured[0]?.image]);
    },
  );

  it("can use either source meta tags or selected JSON-LD independently", () => {
    const fixture = recipePins[0]!;
    for (const html of [
      pinterestHtml({ meta: fixture.meta }),
      pinterestHtml({ structured: fixture.structured }),
    ]) {
      const pin = parsePinterestHtml(html, fixture.sourceUrl);
      expect(pin.links).toContain(fixture.meta["pinterestapp:source"]);
    }
  });

  it("accepts the original pin metadata only when the saved pin confirms that relationship", () => {
    expect(
      parsePinterestHtml(
        pinterestHtml(sharedPastaPin),
        sharedPastaPin.sourceUrl,
      ),
    ).toMatchObject({
      id: "1085719422756328161",
      canonicalUrl: "https://www.pinterest.com/pin/1085719422756328161/",
      title: sharedPastaPin.structured[0]!.headline,
      links: [sharedPastaPin.meta["pinterestapp:source"]],
    });
  });

  it("reads a selected Relay pin without page metadata or related pins", () => {
    const selected = sharedPastaPin.relay.data.v3GetPinQueryv2.data;
    const html = pinterestHtml({
      relay: {
        selected,
        related: {
          ...selected,
          entityId: "999",
          link: "https://wrong.example/",
        },
      },
    });
    expect(parsePinterestHtml(html, sharedPastaPin.sourceUrl)).toMatchObject({
      title: selected.title,
      links: [selected.link],
      images: [selected.imageLargeUrl],
    });
  });

  it("recognizes the selected pin's canonical SEO path in a deferred payload", () => {
    const selected = sharedPastaPin.relay.data.v3GetPinQueryv2.data;
    const html = pinterestHtml({
      ...sharedPastaPin,
      relay: {
        ...selected,
        pinJoin: { seoCanonicalUrl: selected.pinJoin.seoCanonicalUrl },
      },
    });
    expect(parsePinterestHtml(html, sharedPastaPin.sourceUrl).links).toEqual([
      selected.link,
    ]);
  });

  it.each([
    undefined,
    { ...sharedPastaPin.relay.data.v3GetPinQueryv2.data, entityId: "999" },
    { ...sharedPastaPin.relay.data.v3GetPinQueryv2.data, pinJoin: null },
    {
      ...sharedPastaPin.relay.data.v3GetPinQueryv2.data,
      pinJoin: {
        seoCanonicalUrl: "https://evil.example/pin/18436679720775782/",
      },
    },
  ])(
    "rejects different canonical metadata without the selected pin's relationship",
    (relay) => {
      expect(() =>
        parsePinterestHtml(
          pinterestHtml({ ...sharedPastaPin, relay }),
          sharedPastaPin.sourceUrl,
        ),
      ).toThrow("different page");
    },
  );

  it("does not execute JavaScript in Relay payloads", () => {
    const html = `<script data-relay-completed-request="true">window.__PWS_RELAY_REGISTER_COMPLETED_REQUEST__("key", (() => { throw new Error("executed"); })());</script>`;
    expect(() => parsePinterestHtml(html, pinUrl)).toThrow("unavailable");
  });

  it("reads only the requested pin record from embedded state", () => {
    const description =
      "Ingredients:\n- 2 cups flour\n- 1 cup water\nDirections:\nMix flour and water in a bowl.";
    const html = pinterestHtml({
      payload: {
        props: {
          initialReduxState: {
            pins: {
              "999": {
                id: "999",
                type: "pin",
                description: "Unrelated cake",
                link: "https://wrong.example/recipe",
              },
              "123": {
                id: "123",
                type: "pin",
                title: "Flatbread",
                description,
                link: "https://recipe.example/flatbread",
                images: {
                  orig: { url: "https://i.pinimg.com/originals/bread.jpg" },
                },
              },
            },
          },
        },
      },
    });
    expect(parsePinterestHtml(html, pinUrl)).toMatchObject({
      title: "Flatbread",
      description,
      links: ["https://recipe.example/flatbread"],
      images: ["https://i.pinimg.com/originals/bread.jpg"],
    });
  });

  it("ignores unrelated structured posts and arbitrary page anchors", () => {
    const html =
      pinterestHtml({
        meta: {
          "og:url": pinUrl,
          "og:description": "Try this delicious meal!",
        },
        structured: [
          {
            "@type": "SocialMediaPosting",
            mainEntityOfPage: { "@id": "https://www.pinterest.com/pin/999/" },
            sharedContent: { url: "https://wrong.example/cake" },
            articleBody: "2 cups flour and 1 cup water",
          },
        ],
      }) +
      '<a href="https://wrong.example/another-recipe">Recommended recipe</a>';
    expect(parsePinterestHtml(html, pinUrl)).toMatchObject({
      links: [],
      description: "Try this delicious meal!",
    });
  });

  it.each([
    pinterestHtml({ meta: { "og:url": "https://www.pinterest.com/pin/999/" } }),
    "<html><body>Please log in</body></html>",
  ])("rejects unavailable or mismatched pin pages", (html) => {
    expect(() => parsePinterestHtml(html, pinUrl)).toThrow();
  });

  it("does not treat a roundup teaser as recipe evidence", () => {
    const content = parsePinterestHtml(
      pinterestHtml(chiliRoundup),
      chiliRoundup.sourceUrl,
    );
    expect(hasPinterestRecipeEvidence(content.description)).toBe(false);
    expect(hasPinterestRecipeEvidence("Ingredients:\n- potatoes\n- salt")).toBe(
      true,
    );
  });

  it("filters social, CDN and private source links", () => {
    expect(
      extractSocialRecipeLinks(
        [
          "https://127.0.0.1/recipe",
          "https://i.pinimg.com/path",
          "https://www.pinterest.com/pin/999/",
          "https://www.pinterest.co.uk/pin/999/sent/",
          "https://www.allrecipes.com/recipe/123/test/?utm_source=pinterest",
        ],
        pinUrl,
      ),
    ).toEqual(["https://www.allrecipes.com/recipe/123/test/"]);
  });
});

describe("Pinterest fetching", () => {
  it("resolves the reported share through the UK domain and sent path", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 308,
          headers: {
            location:
              "https://api.pinterest.com/url_shortener/6yNaaUV80/redirect/",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            location:
              "https://www.pinterest.co.uk/pin/1085719422756328161/sent/?sfo=1",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 308,
          headers: { location: sharedPastaPin.sourceUrl },
        }),
      )
      .mockResolvedValueOnce(
        new Response(pinterestHtml(sharedPastaPin), {
          headers: { "content-type": "text/html" },
        }),
      );
    vi.stubGlobal("fetch", fetch);
    expect(
      await extractPinterestContent(sharedPastaPin.shareUrl),
    ).toMatchObject({
      id: "1085719422756328161",
      links: [sharedPastaPin.meta["pinterestapp:source"]],
    });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "https://www.pinterest.co.uk/pin/1085719422756328161/",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("follows regional redirects without sending the request back to www", async () => {
    const regional = "https://uk.pinterest.com/pin/123/";
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: regional } }),
      )
      .mockResolvedValueOnce(
        new Response(pinterestHtml({ meta: { "og:url": pinUrl } }), {
          headers: { "content-type": "text/html" },
        }),
      );
    vi.stubGlobal("fetch", fetch);
    expect(await extractPinterestContent(pinUrl)).toMatchObject({
      canonicalUrl: pinUrl,
    });
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      regional,
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("resolves a pin.it share through Pinterest's resolver in one fetch chain", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            location: "https://api.pinterest.com/url_shortener/abc/redirect/",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: pinUrl + "?share=tracking" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(pinterestHtml({ meta: { "og:url": pinUrl } }), {
          headers: { "content-type": "text/html" },
        }),
      );
    vi.stubGlobal("fetch", fetch);
    expect(await extractPinterestContent("https://pin.it/abc")).toMatchObject({
      id: "123",
      canonicalUrl: pinUrl,
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenLastCalledWith(
      pinUrl,
      expect.objectContaining({
        redirect: "manual",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it.each([
    "https://127.0.0.1/recipe",
    "https://pinterest.com.evil.test/pin/123/",
    "https://www.pinterest.com/login/",
    "https://www.pinterest.com/allrecipes/",
    "https://www.pinterest.com/pin/999/",
  ])(
    "does not follow an unsafe or mismatched redirect to %s",
    async (location) => {
      const fetch = vi
        .fn()
        .mockResolvedValue(
          new Response(null, { status: 302, headers: { location } }),
        );
      vi.stubGlobal("fetch", fetch);
      await expect(extractPinterestContent(pinUrl)).rejects.toMatchObject({
        code: "PINTEREST_SOURCE_UNAVAILABLE",
        retryable: false,
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("bounds redirect loops", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            new Response(null, { status: 302, headers: { location: pinUrl } }),
          ),
        ),
    );
    await expect(extractPinterestContent(pinUrl)).rejects.toThrow(
      "too many redirects",
    );
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it.each([
    new Response("x", {
      headers: {
        "content-type": "text/html",
        "content-length": String(3 * 1024 * 1024),
      },
    }),
    new Response("x".repeat(2 * 1024 * 1024 + 1), {
      headers: { "content-type": "text/html" },
    }),
    new Response("{}", { headers: { "content-type": "application/json" } }),
  ])("rejects oversized or non-HTML responses", async (response) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(extractPinterestContent(pinUrl)).rejects.toThrow();
  });
});
