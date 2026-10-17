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
