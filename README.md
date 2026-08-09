# Cook Club

Cook Club is a recipe and meal-planning platform for saving recipes from
anywhere, building a personal cookbook, planning meals, creating shopping
lists, and sharing what is worth making again.

This monorepo contains the Expo mobile app, public and admin web apps,
Cloudflare Workers, and the shared TypeScript packages that power them.

## Repository structure

| Workspace            | Description                                              |
| -------------------- | -------------------------------------------------------- |
| `apps/native`        | Expo app for iOS and Android                             |
| `apps/web`           | Public Astro website and legal/support pages             |
| `apps/admin`         | TanStack Start administration and moderation app         |
| `apps/api`           | Hono API Worker, including tRPC, auth, queues, and feeds |
| `apps/recipe-ai`     | Recipe import and AI Worker                              |
| `apps/images`        | Image upload, storage, and transformation Worker         |
| `packages/auth`      | Shared Better Auth configuration                         |
| `packages/contracts` | Cross-workspace types and service contracts              |
| `packages/db`        | Drizzle schema, migrations, services, and seed data      |
| `packages/shared`    | Runtime-agnostic recipe and ingredient utilities         |
| `packages/trpc`      | Shared tRPC client, router, and feature logic            |
| `tooling/typescript` | Shared TypeScript configuration                          |

The workspace uses [Bun](https://bun.sh/) for package management and
[Nx](https://nx.dev/) for task orchestration and caching. Backend services run
on Cloudflare Workers, with Neon/PostgreSQL used for persistent application
data.

## Prerequisites

- Bun `1.3.14` (the version pinned in `package.json`)
- A PostgreSQL database, such as Neon
- Cloudflare access for Workers that use remote development resources
- Xcode and/or Android Studio when working on the native app

## Getting started

Install all workspace dependencies from the repository root:

```sh
bun install
```

Create local environment files from the tracked templates:

```sh
cp apps/api/.dev.vars.example apps/api/.dev.vars
cp apps/images/.dev.vars.example apps/images/.dev.vars
cp apps/recipe-ai/.dev.vars.example apps/recipe-ai/.dev.vars
cp packages/db/.env.example packages/db/.env
```

At minimum, set `DATABASE_URL` and `BETTER_AUTH_SECRET` in
`apps/api/.dev.vars`, and set the same `DATABASE_URL` in `packages/db/.env`.
Image uploads require the R2 credentials in `apps/images/.dev.vars`. Recipe
import and generation features require the provider keys documented in
[`apps/recipe-ai/README.md`](apps/recipe-ai/README.md).

The native app discovers the local API and image Worker from the Expo dev host
when their URL variables are unset. To configure it explicitly, create
`apps/native/.env` from `apps/native/.env.example`, then replace or remove the
production API URLs in that template before running against local services.

Apply the database migrations, and optionally load the development seed data:

```sh
bun run --cwd packages/db migrate
bun run --cwd packages/db seed
```

Start every app and service, including the iOS app:

```sh
bun run dev
```

To run the backend Workers and admin app without the native or public web apps:

```sh
bun run dev:api
```

You can also run a single workspace directly:

```sh
bun run --cwd apps/native start
bun run --cwd apps/web dev
bun run --cwd apps/admin dev
```

The API waits for the recipe AI and image Workers before it starts. When
running backend workspaces individually, start `apps/images` and
`apps/recipe-ai` before `apps/api`.

## Local services

| Service          | Address                 |
| ---------------- | ----------------------- |
| Admin app        | `http://localhost:3000` |
| Public website   | `http://localhost:4321` |
| API Worker       | `http://localhost:8787` |
| Recipe AI Worker | `http://localhost:8788` |
| Image Worker     | `http://localhost:8789` |

## Common commands

Run these from the repository root:

```sh
bun run lint              # Lint all applicable workspaces
bun run check-types       # Type-check the workspace graph
bun run test              # Run all test targets
bun run build             # Build all build targets
bun run check-boundaries  # Validate workspace dependency boundaries
bun run check:release     # Run the complete release validation suite
bun run kill-ports        # Stop processes on the standard local ports
```

Nx can target an individual project when a full-repository check is not
needed:

```sh
bunx nx run cookclub-api:test
bunx nx run cook-club-app:check-types
```

Database commands are scoped to `packages/db`:

```sh
bun run --cwd packages/db generate    # Generate a migration
bun run --cwd packages/db migrate     # Apply local migrations
bun run --cwd packages/db seed        # Seed development data
bun run --cwd packages/db seed:reset  # Clear and reseed development data
```

## Deployment

Production Worker deployments are exposed as root scripts:

```sh
bun run deploy:images:prod
bun run deploy:recipe-ai:prod
bun run deploy:api:prod
bun run deploy:admin:prod
```

The public website deploys from its workspace with
`bun run --cwd apps/web deploy`. Native builds use the EAS profiles in
`apps/native/eas.json`, for example
`bun run --cwd apps/native build:preview`.

Production credentials belong in the relevant deployment platform or
Cloudflare Worker secrets. Do not commit `.env`, `.env.production`, or
`.dev.vars` files.
