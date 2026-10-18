// Synthetic payloads model formats observed on r/recipes, not captured API responses.
// Body + link: /r/recipes/comments/1x5qaxv/mango_pancakes_with_fresh_mango_and_cream/
// Author comment: /r/recipes/comments/1x374wt/polish_bigos_hultajski/
// Spotlight: /r/recipes/comments/1tu2ej7/introducing_the_spotlight_app_and_my_moms_crock/
// Image galleries: /r/recipes/comments/1uglk05/prison_spread_recipe/
// Ingredients + video: /r/recipes/comments/1x1pwsm/chicken_and_dumplings/
export const postUrl =
  "https://www.reddit.com/r/recipes/comments/abc123/test_flatbread/";
export const writtenRecipe =
  "Ingredients:\n- 2 cups flour\n- 1 cup water\nDirections:\nMix flour and water in a bowl, then bake in the oven.";

// Synthetic Atom entries follow the public feed observed for the reported share:
// /r/recipes/s/ISXgVFSJa3 -> /comments/1x71123/creamy_mushroom_and_wild_rice_soup/
export const reportedShareUrl = "https://www.reddit.com/r/recipes/s/ISXgVFSJa3";
export const reportedPostUrl =
  "https://www.reddit.com/r/recipes/comments/1x71123/creamy_mushroom_and_wild_rice_soup/";
export const galleryShareUrl = "https://www.reddit.com/r/recipes/s/xoUgenRWxT";
export const galleryPostUrl =
  "https://www.reddit.com/r/recipes/comments/1x8sssh/taiwan_double_ninth_festival_ancestral_worship/";

export function feedEntry({
  id = "t3_abc123",
  url = postUrl,
  author = "testcook",
  title = "Test flatbread",
  html = `<div class="md"><p>${writtenRecipe}</p></div>`,
  thumbnail = "",
}: {
  id?: string;
  url?: string;
  author?: string;
  title?: string;
  html?: string;
  thumbnail?: string;
} = {}) {
  const escape = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll('"', "&quot;");
  return `<entry><id>${escape(id)}</id><title>${escape(title)}</title>
    <author><name>/u/${escape(author)}</name></author><link href="${escape(url)}"/>
    <content type="html">${escape(html)}</content>
    ${thumbnail ? `<media:thumbnail url="${escape(thumbnail)}"/>` : ""}</entry>`;
}

export function redditFeed(entries = [feedEntry()]) {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">${entries.join("")}</feed>`;
}

export function listing(children: unknown[]) {
  return { kind: "Listing", data: { children } };
}

export function comment(overrides: Record<string, unknown> = {}) {
  return {
    kind: "t1",
    data: {
      id: "recipe1",
      link_id: "t3_abc123",
      author: "testcook",
      body: writtenRecipe,
      replies: "",
      ...overrides,
    },
  };
}

export function redditPost(
  overrides: Record<string, unknown> = {},
  comments: unknown[] = [],
) {
  return [
    listing([
      {
        kind: "t3",
        data: {
          id: "abc123",
          author: "testcook",
          title: "Test flatbread",
          permalink: "/r/recipes/comments/abc123/test_flatbread/",
          selftext: writtenRecipe,
          ...overrides,
        },
      },
    ]),
    listing(comments),
  ];
}

export const recipeDraft = {
  name: "Test flatbread",
  servings: 2,
  prepTime: null,
  cookTime: null,
  totalTime: null,
  ingredientSections: [
    {
      name: null,
      ingredients: [
        { index: 0, name: "flour", quantity: 2, unit: "cup" },
        { index: 1, name: "water", quantity: 1, unit: "cup" },
      ],
    },
  ],
  instructionSections: [
    {
      name: null,
      instructions: [
        {
          index: 0,
          instruction: "Mix flour and water in a bowl, then bake in the oven.",
        },
      ],
    },
  ],
};
