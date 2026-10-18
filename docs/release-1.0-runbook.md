# cookclub 1.0 release runbook

Production artifacts must be built from the verified, tagged release commit.
Do not paste tokens, signing keys, service-account files, or reviewer passwords
into issues, pull requests, chat, or committed environment files.

## Release configuration

- iOS bundle identifier: `com.shakyhand.cookclub`
- Android package: `com.shakyhand.cookclub`
- Adapty access level: `pro`
- Adapty placement: `pro_paywall`
- App Store products:
  - `com.shakyhand.cookclub.pro.monthly`
  - `com.shakyhand.cookclub.pro.annual`
- Google Play subscription: `cookclub_pro`
  - base plan `monthly`
  - base plan `annual`
- Both plans are automatically renewing and launch without an introductory
  trial.

Set the replacement `SENTRY_AUTH_TOKEN` as a sensitive EAS environment secret
for every environment that uploads source maps. It is a build-time secret and
must never use an `EXPO_PUBLIC_` name. Configure the remaining public mobile
variables in the named `development`, `preview`, and `production` EAS
environments referenced by `apps/native/eas.json`.

## Verification gate

From the repository root, using Bun 1.3.14 and the Node version in
`.node-version`:

```sh
bun install --frozen-lockfile
bun run check-boundaries
bun run lint
bun run check-types
bun run test
bun run build
bun run check:expo
bun run --cwd apps/api dry-run:prod
bun run --cwd apps/images dry-run:prod
bun run --cwd apps/recipe-ai dry-run:prod
bun run --cwd apps/admin dry-run:prod
bun run --cwd apps/web dry-run:prod
```

Regenerate ignored native projects with
`bunx expo prebuild --clean --no-install`. Confirm the merged Android release
manifest targets API 36 and contains no `android.permission.RECORD_AUDIO`.
Confirm the main iOS target has deployment target 16.4, device family 1
(iPhone), and the expected privacy manifest.

Before release, send a Sentry test event from a preview build and confirm it
contains no default user identifiers. Verify source maps were uploaded using
the EAS secret.

## Deployment and testing order

1. Back up the production database and deploy the additive migration.
2. Push the verified commit to `main`. The CI workflow deploys affected
   Cloudflare applications in dependency order and requires the applicable
   production smoke checks to pass. Database backups and migrations are never
   run by CI.
3. Verify report persistence, alert failure handling, child-safety priority,
   every target and reason, duplicate rejection, rate limits, hide/restore,
   ban/unban, audit entries, account-deletion anonymisation, Terms gating, and
   block/unblock behavior.
4. Configure the products in App Store Connect, Google Play Console, and
   Adapty. Verify purchase, pending/cancelled handling, restore, entitlement
   webhooks, reinstall, and cross-device recovery in both sandboxes.
5. Create new iOS and Android preview builds. Smoke-test upgrade persistence
   from the SDK 56 build, especially authentication, MMKV preferences, push
   notifications, image selection, share intents, deep links, and Sentry
   source maps.
6. Smoke-test iOS 16.4 and current iOS on physical iPhones, plus Android 7,
   current Android, and an API 36 device.
7. Push the existing local commits and the release remediation commit, tag the
   verified SHA, and create production builds only from that SHA.

If a Worker deployment needs application-code recovery, use
`wrangler versions list` and `wrangler rollback` from the affected application
workspace. Do not automatically roll back schema-sensitive releases: a Worker
rollback does not revert the database or changes to bound Cloudflare resources,
so confirm compatibility and restore data separately when necessary.

## Store submission

Create both store records manually. Complete English metadata for the United
Kingdom, Ireland, United States, Canada, Australia, and New Zealand, including
screenshots, the Play feature graphic, privacy/data-safety disclosures,
content ratings, subscription disclosures, reviewer notes, and demo
credentials with representative recipes and social activity.

Use these public URLs:

- Privacy: `https://cookclub.app/privacy`
- Terms: `https://cookclub.app/terms`
- Support: `https://cookclub.app/support`
- Account deletion: `https://cookclub.app/delete-account`

Confirm tax, banking, seller, and store agreements are active and record the
approved monthly and annual price tier for every launch market.

Distribute through TestFlight and Play internal testing first. After approval,
use an Apple phased release and a staged Play rollout while monitoring Sentry,
Cloudflare health, subscription webhooks, and the moderation queue.
