# Recipe AI Worker

## Secrets

YouTube Smart Import requires a YouTube Data API key. Store it as a Worker
secret; do not add it to `wrangler.jsonc`.

```sh
bun --cwd apps/recipe-ai wrangler secret put YOUTUBE_API_KEY
bun --cwd apps/recipe-ai wrangler secret put YOUTUBE_API_KEY --env production
```

After adding local secrets, refresh the generated Worker binding types:

```sh
bun --cwd apps/recipe-ai run generate-types
```
