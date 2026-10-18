# Recipe AI Worker

## Secrets

Cerebras is the primary provider for recipe extraction, generation,
personalisation, nutrition, and image understanding. Groq is the fallback for
those requests and provides Instagram, Facebook and Reddit audio transcription. Replicate runs
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

Public post, gallery and comment permalinks, `redd.it` links and Reddit app share
links use the same Smart Import, recipe validation and image staging flow as the
other social platforms. Basic Import routes Reddit users to Smart Import.

Extraction reads the selected post, its author's comments (including nested
replies), and Spotlight's pinned recipe quotes. A specifically shared comment
selects that comment, including recipes from other authors. Linked recipe websites
use the existing website importer. Gallery captions and author comment images are
included; unrelated comments and recommended posts are excluded.

When the written recipe is incomplete, up to three images can be read for visible
recipe text, or a Reddit-hosted video's audio can be transcribed. Images are
normalised to JPEG through the existing image service. Food photos alone do not
provide recipe evidence. Silent videos with instructions only in video frames,
crossposts needing the original thread, galleries needing more than three images,
and comments outside the fetched window are not fully supported. Sharing the
specific recipe comment or importing recipe photos can help with those cases.

Requests and redirects are bounded and validated. Reddit JSON is tried first,
with the post's public Atom (`.rss`) feed as a fallback when JSON is blocked or
returns a JavaScript interstitial. The feed includes post text, author comments,
recipe links and images. If the feed is also blocked, public HTML is tried.
Feeds cannot establish Spotlight's pinned status or supply video audio manifests.
Blocked/private/deleted posts return source-unavailable; rate limits retain
Retry-After or the feed's X-Ratelimit-Reset delay, and timeouts remain retryable.

The Reddit tests use synthetic fixtures based on formats observed in r/recipes;
see `tests/fixtures/reddit.ts` for example posts. They verify extraction, routing,
media handling and failure behaviour, not live Reddit availability or model
accuracy. On 2026-10-18, local live extraction of the reported share link
`https://www.reddit.com/r/recipes/s/ISXgVFSJa3` succeeded through the public feed,
including recipe text and its cover image, while JSON returned HTTP 403.
Access from the deployed Worker still needs verification because Reddit can
block requests from hosting providers.
