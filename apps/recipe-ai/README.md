# Recipe AI Worker

## Secrets

Cerebras is the primary provider for recipe extraction, generation,
personalisation, nutrition, and image understanding. Groq is the fallback for
those requests and provides Instagram and Facebook audio transcription. Replicate runs
Black Forest Labs' FLUX.2 Klein 4B model for recipe image generation. YouTube
Smart Import also requires a YouTube Data API key. Store all provider keys as
Worker secrets; do not add them to `wrangler.jsonc`.

```sh
bun --cwd apps/recipe-ai wrangler secret put CEREBRAS_API_KEY
bun --cwd apps/recipe-ai wrangler secret put CEREBRAS_API_KEY --env production
bun --cwd apps/recipe-ai wrangler secret put GROQ_API_KEY
bun --cwd apps/recipe-ai wrangler secret put GROQ_API_KEY --env production
bun --cwd apps/recipe-ai wrangler secret put REPLICATE_API_TOKEN
bun --cwd apps/recipe-ai wrangler secret put REPLICATE_API_TOKEN --env production
bun --cwd apps/recipe-ai wrangler secret put YOUTUBE_API_KEY
bun --cwd apps/recipe-ai wrangler secret put YOUTUBE_API_KEY --env production
```

For local development, copy `.dev.vars.example` to `.dev.vars` and fill in
the keys. `.dev.vars` is ignored by git.

The Worker does not use a Workers AI binding. WebP recipe imports are converted
to JPEG by the image service before Cerebras is called, which also lets the
same request fail over to Groq vision cleanly.

After adding local secrets, refresh the generated Worker binding types:

```sh
bun run --cwd apps/recipe-ai generate-types
```

## Facebook Smart Import

Public Reel, video, post, group-post and photo permalinks use a dedicated anonymous
Facebook adapter. Share links and `fb.watch` resolve inside the adapter, with
redirect and media-host validation. Basic Import does not accept Facebook links.

The importer uses full captions, recipe comments and linked recipe pages, with
public subtitles or Groq audio transcription for videos. A complete written recipe
skips media extraction. Covers use the existing image staging flow. Text extraction
from photos and login-required content are unsupported.

Run `bun run test` and `bun run test:integration` for offline coverage. See
`tests/fixtures/facebook/README.md` for fixture provenance and test limitations.

## Reddit Smart Import

Availability: Reddit has announced that RSS support ends on **2026-11-13** in its
[October 8 changelog](https://support.reddithelp.com/hc/en-us/articles/54353370049684-Changelog-October-8-2026).
The feed-based importer below passes the recorded live checks but is a temporary
implementation. A supported replacement must be established before relying on it
beyond that date; the same announcement also describes the public Data API's
migration to the Developer Platform.

Public post, gallery and comment permalinks, `redd.it` links and Reddit app share
links use the same Smart Import, recipe validation and image staging flow as the
other social platforms. Basic Import routes Reddit users to Smart Import.

Extraction reads the selected post and its author's comments present in the feed.
A specifically shared comment selects that comment, including recipes from other
authors. Linked recipe websites use the existing website importer. Images exposed
by the post or selected comments are included; unrelated comments and recommended
posts are excluded.

When the written recipe is incomplete, up to three images can be read for visible
recipe text. Images are normalised to JPEG through the existing image service.
Food photos alone do not provide recipe evidence. Video-only recipes, crossposts
needing the original thread, galleries needing more than three images, and
comments outside the fetched window are not fully supported. Sharing the specific
recipe comment or importing recipe photos can help with those cases.

Requests and redirects are bounded and validated. Full browser permalinks and
`redd.it` links normalize directly to a post or comment ID; app share links first
resolve inside Reddit. Both then request the post's public Atom (`.rss`) feed.
There are no unauthenticated JSON, ordinary HTML or Puppeteer attempts for Reddit.
The JSON parser is retained for a future approved OAuth integration.
The feed can supply post text, author comments, recipe links and images. It cannot
establish Spotlight's pinned status or supply video audio manifests, so pinned
recipe-copy selection and video transcription are unavailable in this flow.
Gallery feeds can also omit every image URL. When an otherwise usable feed links
to its own gallery but has no images, the importer makes one optional request to
the post's public embed, bounded to five seconds. It accepts up to three images
from the matching post's gallery carousel on approved Reddit image hosts. A
blocked, redirected or unavailable embed leaves the text recipe usable.
The `reddit_fetch` diagnostic identifies the source (`feed`) and image count.
The fallback path records `reddit_embed_images` or `reddit_embed_images_unavailable`
when gallery image recovery is attempted.
Blocked/private/deleted posts return source-unavailable without trying another
Reddit endpoint; rate limits retain Retry-After or the feed's X-Ratelimit-Reset
delay, and timeouts remain retryable.

The Reddit tests use synthetic fixtures based on formats observed in r/recipes;
see `tests/fixtures/reddit.ts` for example posts. They verify extraction, routing,
media handling and failure behaviour, not live Reddit availability or model
accuracy. On 2026-10-18, local live extraction of the reported share link
`https://www.reddit.com/r/recipes/s/ISXgVFSJa3` succeeded through the public feed,
including recipe text and its cover image, while JSON returned HTTP 403.
Access from the deployed Worker still needs verification because Reddit can
block requests from hosting providers.

On 2026-10-18, the reported gallery share
`https://www.reddit.com/r/recipes/s/xoUgenRWxT` resolved to post `1x8sssh`.
Local JSON returned 403, while its feed returned recipe text without any image
URLs or thumbnails. The public embed returned all nine gallery images both
locally and in an isolated Cloudflare remote preview. The selected DOM fields in
`tests/fixtures/reddit-gallery-embed.html` were captured from that response;
unrelated interface elements and tracking data were removed. Regression tests
replay those fields, with synthetic recipe text, AI responses and image uploads.
Cloudflare feed access also returned 429 during the audit, so successful embed
access does not guarantee that every import can retrieve its recipe text.
After removing the JSON and ordinary HTML attempts, local live checks of both
`https://www.reddit.com/r/recipes/comments/1x8sssh/taiwan_double_ninth_festival_ancestral_worship/`
and its share link returned the same recipe text, four author comments and three
images. The browser permalink needed two requests (feed and embed); the app share
needed an additional redirect request. An immediate repeat feed request returned
429 with a 19-second reset; rechecking after the delay succeeded. Regression tests
cover both URLs through image staging, plus tracking parameters, a missing trailing
slash, `redd.it` links and specifically shared comments.
In the earlier remote preview, the new embed parser recovered three images and
the first image fetched successfully as `image/jpeg`. These were source-access
checks, not deployed end-to-end imports with live AI and image storage.

A subsequent isolated Cloudflare remote preview on 2026-10-18 ran the revised
extractor against both the full browser permalink and the app share link above.
Both returned the same post, 1,350 characters of body text, four author comments
and three gallery images through the feed and optional embed recovery. The first
image also fetched with HTTP 200 and `image/jpeg` in both checks. Requests were
spaced out following the rate limiting observed earlier. This verifies live source
access from Cloudflare for those two checks; it does not establish sustained
availability or exercise live AI extraction and image storage. The preview was
stopped after testing; production was not deployed.
