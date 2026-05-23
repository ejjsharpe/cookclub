# Production Readiness

## Domains

- API/auth Worker: `https://api.cookclub.app`
- Images Worker: `https://images.cookclub.app`
- Production images R2 S3 API: `https://46fa47bc2bba51d75383b4dfe6e3deb1.r2.cloudflarestorage.com/cook-club-images-production`
- Mobile deep link scheme: `cookclub://`

Before release, add `cookclub.app` to Cloudflare and verify the custom domains in the Worker routes.

## Auth Routes

- Better Auth base URL: `https://api.cookclub.app/auth`
- Google callback: `https://api.cookclub.app/auth/callback/google`
- Apple callback: `https://api.cookclub.app/auth/callback/apple`
- Mobile callback URL: `cookclub://`

## Required Secrets

Set these for `cookclub-api-production`:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `RESEND_API_KEY`
- `APPLE_CLIENT_ID`
- `APPLE_CLIENT_SECRET`
- `EXPO_ACCESS_TOKEN`
- `ADAPTY_SECRET_API_KEY`
- `ADAPTY_WEBHOOK_AUTHORIZATION`

`APPLE_BUNDLE_IDENTIFIER`, `ADAPTY_PRO_ACCESS_LEVEL_ID`, `BETTER_AUTH_URL`, and
`IMAGE_PUBLIC_URL` are non-secret production vars already supplied by
`apps/api/wrangler.jsonc`.

Set these for `cookclub-images-production`:

- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

Set these in EAS production environment:

- `EXPO_PUBLIC_ADAPTY_PUBLIC_SDK_KEY`
- `EXPO_PUBLIC_ADAPTY_PAYWALL_PLACEMENT_ID`

`EXPO_PUBLIC_AUTH_BASE_URL` and `EXPO_PUBLIC_API_URL` are currently supplied by
`apps/native/eas.json` for preview and production builds.

## Cloudflare Protection

The API Worker uses Rate Limiting bindings for:

- `API_RATE_LIMITER`: broad API Worker IP burst protection
- `AI_RATE_LIMITER`: authenticated per-user AI burst protection
- `IMAGE_AI_RATE_LIMITER`: authenticated per-user image AI burst protection
- `UPLOAD_RATE_LIMITER`: authenticated per-user upload URL burst protection

Also configure Cloudflare WAF/rate limiting rules at the zone level for:

- `/auth/*` login/signup bursts by IP
- `/trpc/*` abusive IP request volume
- Known bad bots and countries only if that fits the launch market

Use durable DB-backed quotas later only for hard daily/monthly AI budgets or billing.

The development API Worker uses separate Wrangler rate-limit namespace IDs
(`4602001` through `4602004`) from production (`4601001` through `4601004`).
Cloudflare requires these namespace IDs to be integer strings, so they do not
carry the environment name in the dashboard.

## Database

Run migrations before deploying the production mobile build. The migration history has been squashed pre-launch, so `0000_initial_schema.sql` is the baseline schema for a fresh database.

For a clean local development reset:

1. `bun run --cwd packages/db migrate`
2. `bun run --cwd packages/db seed:reset`

For the production env file:

1. `bun run --cwd packages/db migrate:prod`

## Store/Provider Notes

If Google sign-in is available on iOS, keep Sign in with Apple enabled and configured before App Store submission.

## EAS Release Flow

Run from `apps/native` unless otherwise stated:

1. Confirm Expo config is valid: `bunx expo config --type public`
2. Confirm Expo dependency/native config health: `bunx expo-doctor`
3. Build iOS: `eas build --platform ios --profile production`
4. Build Android: `eas build --platform android --profile production`
5. Submit iOS after the App Store Connect app exists:
   `eas submit --platform ios --profile production --latest`
6. Submit Android after the first manual Google Play upload and service account setup:
   `eas submit --platform android --profile production --latest`

EAS Submit uploads to App Store Connect/TestFlight or Google Play. It does not
finish the store review process for you; complete metadata, screenshots, privacy
forms, and final submission in each store console.

## Apple App Store Setup

Current iOS identifiers:

- App bundle ID: `com.shakyhand.cookclub`
- Share extension bundle ID: `com.shakyhand.cookclub.share-extension`
- App group: `group.com.shakyhand.cookclub`

Steps:

1. In Apple Developer, open Certificates, Identifiers & Profiles.
2. Register an explicit App ID for `com.shakyhand.cookclub`.
3. Enable capabilities needed by the native app:
   - Sign in with Apple
   - Push Notifications
   - App Groups
   - In-App Purchase
4. Register the app group `group.com.shakyhand.cookclub`.
5. Assign the app group to the main App ID.
6. Register an explicit App ID for the share extension:
   `com.shakyhand.cookclub.share-extension`.
7. Enable App Groups for the share extension and assign
   `group.com.shakyhand.cookclub`.
8. Create/configure Sign in with Apple credentials for the backend. Production
   callback URL: `https://api.cookclub.app/auth/callback/apple`.
9. In App Store Connect, create a new app record using bundle ID
   `com.shakyhand.cookclub`.
10. Complete app metadata: name, subtitle, category, description, keywords,
    support URL, marketing URL if used, privacy policy URL, age rating, pricing,
    and availability.
11. Add screenshots for required device classes.
12. Complete App Privacy details. Make sure they match the privacy policy.
13. Configure subscriptions/products in App Store Connect and mirror them in
    Adapty.
14. Upload the first build with EAS, test it in TestFlight, then choose the
    build in App Store Connect and submit it for App Review.

Review notes to keep ready:

- Account deletion is in Settings > Delete Account.
- Deleting an account does not cancel App Store or Google Play subscriptions.
- Encryption is configured as non-exempt in `apps/native/app.json`.

## Google Play Setup

Current Android identifier:

- Package name: `com.shakyhand.cookclub`

Steps:

1. In Play Console, create the app with default language, app name, app type,
   free/paid status, contact email, and declarations.
2. Accept Play App Signing when creating the app.
3. Treat `com.shakyhand.cookclub` as permanent; Play package names cannot be
   casually reused after release.
4. Complete the Play app dashboard setup:
   - Main store listing
   - Privacy policy URL
   - App access instructions for reviewers
   - Ads declaration
   - Content rating
   - Target audience and content
   - Data safety form
   - Account deletion web link
5. Configure subscriptions/products in Play Console and mirror them in Adapty.
6. Build the Android production artifact with EAS.
7. Upload the first Android App Bundle manually in Play Console. Google Play API
   submission cannot be used for the very first upload.
8. Configure Google Play API access and a service account for EAS Submit.
9. After the first upload, use `eas submit --platform android --profile production --latest`
   for later submissions.
10. If the Play Console account is a new personal developer account, plan for
    closed testing with at least 12 opted-in testers for 14 continuous days
    before production access.

## Provider Setup

Adapty:

1. Create iOS and Android apps in Adapty.
2. Add App Store and Play Store credentials.
3. Create products/subscriptions matching each store.
4. Create paywall placement `pro_paywall` or update
   `EXPO_PUBLIC_ADAPTY_PAYWALL_PLACEMENT_ID`.
5. Set the mobile public SDK key in EAS.
6. Set `ADAPTY_SECRET_API_KEY` and `ADAPTY_WEBHOOK_AUTHORIZATION` on the API
   Worker.
7. Configure Adapty webhook URL:
   `https://api.cookclub.app/api/adapty/webhook`.

OAuth/email:

1. Google OAuth production callback:
   `https://api.cookclub.app/auth/callback/google`.
2. Apple OAuth production callback:
   `https://api.cookclub.app/auth/callback/apple`.
3. Verify the Resend sending domain and set `RESEND_API_KEY`.

## Detailed Manual Runbook

This section is the exact order to follow before the first production store
submission. Values shown here are tied to the current app config:

- iOS bundle ID: `com.shakyhand.cookclub`
- iOS share extension bundle ID: `com.shakyhand.cookclub.share-extension`
- iOS app group: `group.com.shakyhand.cookclub`
- Android package name: `com.shakyhand.cookclub`
- API/auth URL: `https://api.cookclub.app`
- tRPC URL: `https://api.cookclub.app/trpc`
- Image URL: `https://images.cookclub.app`
- Mobile scheme: `cookclub://`

### 0. Resolve Store Review Blockers

Cook Club has user-generated content and social features: recipes, review text,
review images, comments, profiles, follows, and public/shared activity.

Before submitting to Apple or Google, either implement moderation controls or
temporarily remove/disable public UGC surfaces. The safer route is to implement:

1. Terms of use users must accept before creating/uploading UGC.
2. A content policy that forbids objectionable content and abusive behavior.
3. In-app report actions for users, recipes/activity, review images, and comments.
4. In-app block user action from user profiles and content menus.
5. Backend tables/endpoints to record reports and blocks.
6. Feed/comment/search filtering that hides blocked users and hidden/reported
   content where appropriate.
7. A support/moderation email on the public website and in store metadata.

This is required because Apple App Review Guideline 1.2 expects UGC apps to have
filtering, reporting, blocking, and contact information. Google Play also expects
UGC apps to provide reporting/blocking and ongoing moderation.

### 1. Create Public Web Pages

Create these pages before filling out store forms:

1. `https://cookclub.app`
   - Explain what Cook Club does.
   - Include links to privacy policy, terms, support, and account deletion.
   - Google OAuth production apps are expected to have a public homepage on a
     verified domain.
2. `https://cookclub.app/privacy`
   - Title it clearly as "Privacy Policy".
   - Name the app/developer: Cook Club.
   - Include privacy contact email.
   - Disclose data collected: name, email, user ID, username/profile, recipes,
     review text/images, comments, follows, meal plans, shopping lists,
     subscription status, device push token, diagnostics/logs if used.
   - Disclose processors/providers: Cloudflare, Neon/Postgres, Expo, Apple,
     Google, Adapty, Resend, and any analytics/crash tool if added later.
   - Explain encryption in transit, retention, and deletion.
   - Make it public, not geofenced, not behind auth, and not a PDF.
3. `https://cookclub.app/terms`
   - Include user content rules.
   - State that users must own/have rights to content they upload.
   - Prohibit abusive, illegal, sexually explicit, hateful, harassing, and
     infringing content.
   - Include moderation/removal and account suspension language.
4. `https://cookclub.app/delete-account`
   - Reference Cook Club by name.
   - Explain in-app deletion path: Settings > Delete Account.
   - Provide an outside-app deletion request path for users who uninstalled the
     app. A simple form or support email is acceptable if it is prominent.
   - Explain that deleting the app account does not cancel Apple/Google
     subscriptions and link to subscription management instructions.
   - Explain any data you retain for legal/security/payment reasons.
5. `https://cookclub.app/support`
   - Provide a support email reviewers and users can contact.

### 2. Configure Cloudflare Domain, R2, and Worker Secrets

1. In Cloudflare, add or confirm the `cookclub.app` zone.
2. Confirm DNS is active for the zone.
3. Confirm the production Worker custom domains will be:
   - `api.cookclub.app` for `cookclub-api-production`
   - `images.cookclub.app` for `cookclub-images-production`
4. In Cloudflare Workers, confirm or create these Workers via Wrangler deploy:
   - `cookclub-api-development`
   - `cookclub-api-production`
   - `cookclub-images-development`
   - `cookclub-images-production`
   - `cookclub-recipe-ai-development`
   - `cookclub-recipe-ai-production`
5. In Cloudflare R2, confirm or create these buckets:
   - `cook-club-images-development`
   - `cook-club-images-production`
6. Enable public `r2.dev` access only for `cook-club-images-development`, then
   copy the returned public URL into the development `IMAGE_PUBLIC_URL`,
   `PUBLIC_URL`, and `R2_ORIGIN_URL` values in the Worker configs.
7. In Cloudflare KV, create separate recipe cache namespaces and copy the IDs
   into `apps/recipe-ai/wrangler.jsonc`:
   - `cookclub-recipe-cache-development`
   - `cookclub-recipe-cache-development-preview`
   - `cookclub-recipe-cache-production`
   - `cookclub-recipe-cache-production-preview`
8. In Cloudflare R2 > Manage API Tokens, create R2 API tokens:
   - Permissions: Object Read & Write
   - Development scope: specific bucket `cook-club-images-development`
   - Production scope: specific bucket `cook-club-images-production`
   - Record the Access Key ID and Secret Access Key once.
9. Create a production Postgres database and get the pooled connection string.
   Use that value for `DATABASE_URL`.
10. Generate secrets locally:
   - `BETTER_AUTH_SECRET`: generate a long random value.
   - `ADAPTY_WEBHOOK_AUTHORIZATION`: use a value like `Bearer <long-random>`.
11. Set API Worker production secrets. The easiest path is to copy the production
   template and bulk-upload it:

   ```bash
   cd apps/api
   cp .env.production.example .env.production
   # Fill .env.production with real values.
   bunx wrangler secret bulk .env.production --env production
   ```

   Do not add `BETTER_AUTH_URL`, `IMAGE_PUBLIC_URL`,
   `APPLE_BUNDLE_IDENTIFIER`, or `ADAPTY_PRO_ACCESS_LEVEL_ID` to this secrets
   file unless you intentionally move those non-secret values out of
   `wrangler.jsonc`.

12. Set Images Worker production secrets:

   ```bash
   cd apps/images
   cp .env.production.example .env.production
   # Fill .env.production with real R2 values.
   bunx wrangler secret bulk .env.production --env production
   ```

13. Create a local untracked production DB env file:

    ```bash
    cp packages/db/.env.production.example packages/db/.env.production
    ```

    Fill `DATABASE_URL` in `packages/db/.env.production`.

14. Run production migrations:

    ```bash
    bun run --cwd packages/db migrate:prod
    ```

15. Deploy Workers in dependency order:

    ```bash
    bun run deploy:images:prod
    bun run deploy:recipe-ai:prod
    bun run deploy:api:prod
    ```

16. Smoke-test public endpoints:

    ```bash
    curl -I https://images.cookclub.app
    curl -I https://api.cookclub.app/auth/session
    ```

### 3. Configure Resend

1. In Resend, add the sending domain `cookclub.app`.
2. Add the DNS records Resend provides in Cloudflare DNS.
3. Wait until Resend marks the domain verified.
4. Create a production API key in Resend.
5. Put that API key into the API Worker secret `RESEND_API_KEY`.
6. Confirm the app's sender address is available:
   `Cook Club <noreply@cookclub.app>`.
7. Create a test account and verify that the signup email arrives.

### 4. Configure OAuth Providers

Google:

1. Open Google Cloud Console.
2. Select or create the Cook Club production project.
3. Go to APIs & Services > OAuth consent screen.
4. Set publishing status to Production when ready.
5. Add app name, support email, developer contact email, app homepage,
   privacy policy, and terms URLs.
6. Verify/authorize the domain `cookclub.app`.
7. Go to APIs & Services > Credentials > Create credentials > OAuth client ID.
8. Choose Web application.
9. Add authorized redirect URI exactly:
   `https://api.cookclub.app/auth/callback/google`
10. Put the generated client ID and secret into:
    - `GOOGLE_CLIENT_ID`
    - `GOOGLE_CLIENT_SECRET`

Apple:

1. In Apple Developer, go to Certificates, Identifiers & Profiles.
2. Create or open the main App ID `com.shakyhand.cookclub`.
3. Enable Sign in with Apple and configure it as a primary App ID.
4. Create a Services ID for web auth, for example:
   `com.shakyhand.cookclub.auth`.
5. On that Services ID, enable Sign in with Apple.
6. Associate it with the primary App ID `com.shakyhand.cookclub`.
7. Add domain/subdomain: `api.cookclub.app`.
8. Add return URL exactly:
   `https://api.cookclub.app/auth/callback/apple`
9. Create a Sign in with Apple private key and download the `.p8` once.
10. Generate the Apple client secret/JWT required by Better Auth using that key.
11. Put values into API Worker secrets:
    - `APPLE_CLIENT_ID`: the Services ID, for example
      `com.shakyhand.cookclub.auth`
    - `APPLE_CLIENT_SECRET`: generated JWT/client secret

### 5. Configure Adapty and Store Products

Use one access level unless the product model changes:

- Access level ID: `pro`
- Placement ID: `pro_paywall`

Apple subscriptions:

1. In App Store Connect, open the Cook Club app.
2. Go to Monetization > Subscriptions.
3. Create one subscription group, for example "Cook Club Pro".
4. Add subscription products. Choose stable product IDs, for example:
   - `cookclub_pro_monthly`
   - `cookclub_pro_yearly`
5. Set duration, price, availability, localization, and review information for
   each product.
6. Add screenshot/review notes for the in-app purchase review.

Google subscriptions:

1. In Play Console, open the Cook Club app.
2. Go to Monetize with Play > Products > Subscriptions.
3. Create matching subscription products/base plans.
4. Use stable product IDs matching Adapty setup, for example:
   - `cookclub_pro_monthly`
   - `cookclub_pro_yearly`
5. Configure base plans, prices, regions, and offers if needed.
6. Activate the base plans when ready.

Adapty:

1. Create or open the Cook Club app in Adapty.
2. Add iOS app settings:
   - Bundle ID: `com.shakyhand.cookclub`
   - Apple app ID: from App Store Connect > App Information.
3. Add Android app settings:
   - Package name: `com.shakyhand.cookclub`
4. Connect App Store and Google Play credentials in Adapty.
5. Import or create the products matching the store product IDs.
6. Create access level `pro`.
7. Attach the products to access level `pro`.
8. Create a paywall.
9. Create placement `pro_paywall`.
10. Attach the paywall to placement `pro_paywall`.
11. If using Adapty Paywall Builder, turn on "Show on device" for the paywall.
12. Copy the Public SDK Key from Adapty app settings.
13. Set EAS production env vars:

    ```bash
    cd apps/native
    eas env:create --environment production --name EXPO_PUBLIC_ADAPTY_PUBLIC_SDK_KEY --value "<adapty-public-sdk-key>" --visibility plaintext
    eas env:create --environment production --name EXPO_PUBLIC_ADAPTY_PAYWALL_PLACEMENT_ID --value "pro_paywall" --visibility plaintext
    ```

14. Copy the Adapty Secret API Key and set API Worker secret
    `ADAPTY_SECRET_API_KEY`.
15. In Adapty webhooks, add endpoint:
    `https://api.cookclub.app/api/adapty/webhook`
16. Add request header:
    - Header name: `Authorization`
    - Header value: exactly the same value as `ADAPTY_WEBHOOK_AUTHORIZATION`.
17. Send a test webhook if Adapty offers it and confirm the API returns 200.

### 6. Configure EAS Credentials and Environment

1. Install/login if needed:

   ```bash
   npm install -g eas-cli
   eas login
   ```

2. Confirm this project is linked:

   ```bash
   cd apps/native
   eas project:info
   ```

3. Confirm production EAS env vars:

   ```bash
   eas env:list --environment production
   ```

   You should see:
   - `EXPO_PUBLIC_ADAPTY_PUBLIC_SDK_KEY`
   - `EXPO_PUBLIC_ADAPTY_PAYWALL_PLACEMENT_ID`

4. Configure iOS credentials:

   ```bash
   eas credentials --platform ios
   ```

   Recommended choices:
   - Build profile: `production`
   - Let EAS manage distribution certificate and provisioning profile.
   - Let EAS configure push notification credentials if prompted.
   - Ensure the app identifier is `com.shakyhand.cookclub`.
   - Ensure app extension identifier is
     `com.shakyhand.cookclub.share-extension`.

5. Configure Android credentials:

   ```bash
   eas credentials --platform android
   ```

   Recommended choices:
   - Build profile: `production`
   - Let EAS generate/manage the upload keystore for the first release.
   - Keep Play App Signing enabled in Play Console.

6. Optional but recommended for EAS Submit iOS: create an App Store Connect API
   key.
   - App Store Connect > Users and Access > Integrations > App Store Connect API.
   - Create a key with an appropriate role, normally App Manager/Admin.
   - Download the `.p8` file once.
   - Configure via `eas credentials --platform ios` or `eas.json` submit fields.

7. Optional but recommended for EAS Submit Android after the first manual upload:
   - Play Console > Setup > API access.
   - Link/create Google Cloud project.
   - Create service account.
   - Grant Play Console permissions for releases on the required track.
   - Download service account JSON.
   - Upload it via `eas credentials --platform android`.

### 7. Configure Apple Developer and App Store Connect

Apple Developer identifiers:

1. Open Apple Developer > Certificates, Identifiers & Profiles > Identifiers.
2. Click `+`.
3. Choose App IDs > App.
4. Description: `Cook Club`.
5. Bundle ID: Explicit.
6. Bundle ID value: `com.shakyhand.cookclub`.
7. Enable capabilities:
   - Sign in with Apple
   - Push Notifications
   - App Groups
8. In-App Purchase is enabled by default for explicit App IDs, but confirm the
   app is eligible for subscriptions in App Store Connect.
9. Register the App ID.
10. Create App Group:
    - Identifier: `group.com.shakyhand.cookclub`
11. Edit main App ID and assign the app group.
12. Create second App ID for the share extension:
    - Description: `Cook Club Share Extension`
    - Bundle ID: `com.shakyhand.cookclub.share-extension`
13. Enable App Groups on the share extension App ID.
14. Assign `group.com.shakyhand.cookclub` to the share extension.

App Store Connect app record:

1. Open App Store Connect > Apps.
2. Click `+` > New App.
3. Platform: iOS.
4. Name: `Cook Club`.
5. Primary language: choose your launch metadata language.
6. Bundle ID: `com.shakyhand.cookclub`.
7. SKU: `com.shakyhand.cookclub`.
8. User Access: Full Access unless you need restricted team access.
9. Click Create.
10. Go to App Information:
    - Subtitle: write concise store copy.
    - Category: likely Food & Drink.
    - Content Rights: answer based on whether you own/have licensed all content.
    - Age Rating: complete questionnaire honestly, including UGC/social features.
11. Pricing and Availability:
    - Choose price: free if subscriptions unlock Pro.
    - Choose countries/regions.
12. App Privacy:
    - Add privacy policy URL.
    - Complete collected data declarations to match the privacy policy.
13. App Review Information:
    - Contact name/email/phone.
    - Demo account credentials if the reviewer needs login.
    - Notes: mention "Account deletion is available in Settings > Delete
      Account. Subscription cancellation remains managed by Apple/Google."
14. Add screenshots for required iPhone sizes and iPad if supporting tablet.
15. Add description, keywords, support URL, marketing URL if used, and copyright.
16. Configure subscriptions under Monetization > Subscriptions.
17. Once an EAS iOS build is uploaded and processed, attach it to the app version.
18. Submit to TestFlight first.
19. Test sign up, email verification, Google login, Apple login, paywall,
    purchase/restore, recipe import, image upload, push permission, share
    extension, account deletion.
20. Submit for App Review only after TestFlight is clean.

### 8. Configure Google Play Console

Create app:

1. Open Play Console.
2. Go to Home > Create app.
3. App name: `Cook Club`.
4. Default language: choose your launch metadata language.
5. App or game: App.
6. Free or paid: Free if subscriptions unlock Pro.
7. App support email: use your support email.
8. Accept Developer Program Policies and US export laws declarations.
9. Accept Play App Signing terms.
10. Create app.

App setup:

1. Confirm package name: `com.shakyhand.cookclub`.
2. Main store listing:
   - App name: `Cook Club`.
   - Short description: max 80 chars.
   - Full description: max 4000 chars.
   - App icon, feature graphic, phone screenshots, tablet screenshots if needed.
3. Store settings:
   - App category: Food & Drink or Lifestyle, depending on positioning.
   - Contact email.
   - Website: `https://cookclub.app`.
4. App content:
   - Privacy policy: `https://cookclub.app/privacy`.
   - App access: provide reviewer instructions and demo login if needed.
   - Ads: answer no unless ads are added.
   - Content rating: complete questionnaire honestly.
   - Target audience and content: choose intended age range.
   - News apps / government / financial features: answer no unless applicable.
   - Data safety: declare collected/shared data and security practices.
   - Account deletion: provide `https://cookclub.app/delete-account` and confirm
     in-app deletion path.
5. Monetize with Play:
   - Set up payments profile if not already done.
   - Create subscriptions/base plans matching Adapty product IDs.
6. Testing:
   - Start with Internal testing for quick install checks.
   - Then use Closed testing before production.
   - If this is a new personal developer account created after November 13,
     2023, plan for at least 12 opted-in closed testers for 14 continuous days
     before applying for production access.
7. First Android upload:
   - Build an Android production AAB with EAS.
   - Upload it manually once in Play Console. The Google Play API cannot be used
     for the first upload.
8. After first upload:
   - Set up Play Console API access and EAS Submit service account.
   - Use EAS Submit for future uploads.
9. Production release:
   - Create a production release from the tested app bundle.
   - Review policy warnings/pre-launch report.
   - Use staged rollout rather than immediate 100% rollout for the first launch.

### 9. Build and Submit

Before building:

```bash
cd apps/native
bunx expo config --type public
bunx expo-doctor
```

Build:

```bash
eas build --platform ios --profile production
eas build --platform android --profile production
```

Submit iOS after App Store Connect app record exists:

```bash
eas submit --platform ios --profile production --latest
```

For Android, manually upload the first AAB in Play Console. After that first
manual upload and service account setup:

```bash
eas submit --platform android --profile production --latest
```

### 10. Production Smoke Test

Run this checklist on real devices before pressing final store submission:

1. Fresh install opens without dev server.
2. Email signup sends verification email from `noreply@cookclub.app`.
3. Google login succeeds and returns to the app.
4. Apple login succeeds on iOS and returns to the app.
5. Onboarding completes.
6. Recipe URL import works.
7. Image/text smart import works and respects Pro limits.
8. Image upload displays from `https://images.cookclub.app`.
9. Follow/search/feed flows work.
10. Comments/reviews work.
11. Push notification permission and token registration work.
12. Paywall loads placement `pro_paywall`.
13. Purchase works in sandbox/test mode.
14. Restore purchases works.
15. Share extension appears and imports shared content.
16. Settings > Delete Account deletes the account and returns to signed-out
    state.
17. External account deletion page works without the app installed.
18. App works after force close/reopen.
19. App works on poor network/no network where expected.
20. No test data, placeholder text, debug banners, or localhost URLs remain.

## Official References

- Expo EAS environment variables:
  https://docs.expo.dev/eas/environment-variables/
- Expo submit to app stores:
  https://docs.expo.dev/deploy/submit-to-app-stores/
- Expo EAS Submit behavior:
  https://docs.expo.dev/submit/introduction/
- Apple App ID registration:
  https://developer.apple.com/help/account/identifiers/register-an-app-id
- Apple capabilities:
  https://developer.apple.com/help/account/identifiers/enable-app-capabilities/
- Apple App Store Connect app records:
  https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app/
- Apple account deletion guidance:
  https://developer.apple.com/support/offering-account-deletion-in-your-app/
- Google Play app setup:
  https://support.google.com/googleplay/android-developer/answer/9859152
- Google Play account deletion requirements:
  https://support.google.com/googleplay/android-developer/answer/13327111
- Google Play Data safety:
  https://support.google.com/googleplay/android-developer/answer/10787469
- Google Play new personal account testing:
  https://support.google.com/googleplay/android-developer/answer/14151465
- Apple App Review UGC rules:
  https://developer.apple.com/app-store/review/guidelines/
- Google Play UGC policy:
  https://support.google.com/googleplay/android-developer/answer/9876937
- Google OAuth web server redirect URI rules:
  https://developers.google.com/identity/protocols/oauth2/web-server
- Apple Sign in with Apple web configuration:
  https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web
- Cloudflare Workers secrets:
  https://developers.cloudflare.com/workers/configuration/secrets/
- Cloudflare Workers environments:
  https://developers.cloudflare.com/workers/wrangler/environments/
- Cloudflare R2 S3 credentials:
  https://developers.cloudflare.com/r2/api/s3/tokens/
- Adapty React Native paywalls:
  https://adapty.io/docs/react-native-quickstart-paywalls
