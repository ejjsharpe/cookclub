import { expo } from "@better-auth/expo";
import { getDb, type DbEnv } from "@repo/db";
import * as schema from "@repo/db/schemas";
import { getOrCreateDefaultCollections } from "@repo/db/services";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import type { AppleProfile } from "better-auth/social-providers";
import { Resend } from "resend";

const FROM_EMAIL = "cookclub <noreply@cookclub.app>";
const REPLY_TO_EMAIL = "help@cookclub.app";
const AUTH_BASE_PATH = "/auth";
const SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 30;
type SocialProvider = "google" | "apple";

function privateErrorStack(error: unknown): string {
  const stacks: string[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current instanceof Error && !seen.has(current) && stacks.length < 5) {
    seen.add(current);
    stacks.push(current.stack ?? current.name);
    current = current.cause;
  }
  return stacks.join("\nCaused by: ");
}

export interface AuthEnv extends DbEnv {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  APPLE_CLIENT_ID?: string;
  APPLE_CLIENT_SECRET?: string;
  APPLE_BUNDLE_IDENTIFIER?: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  RESEND_API_KEY: string;
  TRUSTED_ORIGINS?: string;
}

function shouldRequireEmailVerification(env: AuthEnv): boolean {
  try {
    const authUrl = new URL(env.BETTER_AUTH_URL);
    return !["localhost", "127.0.0.1", "0.0.0.0"].includes(authUrl.hostname);
  } catch {
    return true;
  }
}

async function sendEmail(
  env: AuthEnv,
  options: { to: string; subject: string; html: string },
) {
  const resend = new Resend(env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    replyTo: REPLY_TO_EMAIL,
    ...options,
  });
  if (error) {
    throw new Error("Email provider request failed", { cause: error });
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getTrustedOrigins(env: AuthEnv): string[] {
  const configured =
    env.TRUSTED_ORIGINS?.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean) ?? [];

  return Array.from(
    new Set([
      "cookclub://",
      "https://cookclub.app",
      "https://www.cookclub.app",
      "https://api.cookclub.app",
      "https://admin.cookclub.app",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://localhost:4321",
      "http://127.0.0.1:4321",
      "https://appleid.apple.com",
      env.BETTER_AUTH_URL,
      ...configured,
    ]),
  );
}

function getAuthBaseUrl(env: AuthEnv): string {
  return `${env.BETTER_AUTH_URL.replace(/\/+$/, "")}${AUTH_BASE_PATH}`;
}

function getCallbackUrl(env: AuthEnv, provider: SocialProvider): string {
  return `${getAuthBaseUrl(env)}/callback/${provider}`;
}

export function getAuth(
  env: AuthEnv,
  runtime: {
    requestId?: string;
    route?: string;
    waitUntil?: (promise: Promise<unknown>) => void;
  } = {},
) {
  const db = getDb(env);
  const requireEmailVerification = shouldRequireEmailVerification(env);
  const googleProvider =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            redirectURI: getCallbackUrl(env, "google"),
          },
        }
      : {};
  const appleProvider =
    env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET
      ? {
          apple: {
            clientId: env.APPLE_CLIENT_ID,
            clientSecret: env.APPLE_CLIENT_SECRET,
            redirectURI: getCallbackUrl(env, "apple"),
            mapProfileToUser: (profile: AppleProfile) => ({
              // Apple only includes email on the first authorization, while
              // Better Auth requires one for every social sign-in attempt.
              email: profile.email ?? `${profile.sub}@apple.placeholder.local`,
            }),
            ...(env.APPLE_BUNDLE_IDENTIFIER && {
              appBundleIdentifier: env.APPLE_BUNDLE_IDENTIFIER,
            }),
          },
        }
      : {};

  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    basePath: AUTH_BASE_PATH,
    secret: env.BETTER_AUTH_SECRET,
    onAPIError: {
      onError(error) {
        const candidate =
          error && typeof error === "object"
            ? (error as { status?: unknown; statusCode?: unknown })
            : undefined;
        const isExpectedClientError =
          (typeof candidate?.statusCode === "number" &&
            candidate.statusCode < 500) ||
          (typeof candidate?.status === "string" &&
            ![
              "INTERNAL_SERVER_ERROR",
              "BAD_GATEWAY",
              "SERVICE_UNAVAILABLE",
              "GATEWAY_TIMEOUT",
            ].includes(candidate.status));
        if (isExpectedClientError) return;

        console.error(
          JSON.stringify({
            requestId: runtime.requestId ?? "unknown",
            route: runtime.route ?? "auth",
            status: 500,
            publicCode: "SERVICE_UNAVAILABLE",
            errorStack: privateErrorStack(error),
          }),
        );
      },
    },
    database: drizzleAdapter(db, {
      provider: "pg",
      schema,
    }),
    session: {
      expiresIn: SESSION_EXPIRES_IN_SECONDS,
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await getOrCreateDefaultCollections(db, user.id);
          },
        },
      },
    },
    plugins: [
      expo(),
      admin({
        defaultRole: "user",
        adminRoles: ["admin"],
      }),
    ],
    trustedOrigins: getTrustedOrigins(env),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      // Sign-up never says an email is taken (it looks like it worked), so
      // the owner gets an email instead. Otherwise a returning user who
      // tried "Create account" would wait for a verification email that
      // never comes.
      onExistingUserSignUp: async ({ user }) => {
        await sendEmail(env, {
          to: user.email,
          subject: "You already have a cookclub account",
          html: `<p>Someone, probably you, tried to create a cookclub account with this email.</p><p>You already have one. Open the app and choose <strong>Continue with email</strong>, then <strong>Sign in</strong>. If you've forgotten your password, you can reset it from there.</p><p>If this wasn't you, you can ignore this email.</p>`,
        });
      },
      sendResetPassword: async ({ user, url, token }) => {
        // Better Auth has already checked this callback against trustedOrigins.
        // A fragment keeps the bearer token out of HTTP access logs/referrers.
        const callback = new URL(url).searchParams.get("callbackURL");
        // Relative callbacks use the same public site as the default link.
        const resetUrl = new URL(
          callback || "/reset-password",
          "https://cookclub.app",
        );
        resetUrl.hash = new URLSearchParams({ token }).toString();
        const delivery = sendEmail(env, {
          to: user.email,
          subject: "Reset your password - cookclub",
          html: `<p>You requested a new password for your cookclub account.</p><p><a href="${escapeHtml(resetUrl.toString())}">Reset password</a></p><p>This link expires in one hour and can only be used once.</p><p>If you didn't request this, you can ignore this email. Your password will stay the same.</p>`,
        });

        // Keep email delivery out of the response timing, while allowing the
        // Worker to finish sending after the request has returned.
        if (runtime.waitUntil) {
          runtime.waitUntil(
            delivery.catch(() => {
              console.error(
                JSON.stringify({
                  requestId: runtime.requestId ?? "unknown",
                  route: "/auth/request-password-reset",
                  publicCode: "SERVICE_UNAVAILABLE",
                  message: "Password reset email delivery failed",
                }),
              );
            }),
          );
        } else {
          await delivery;
        }
      },
      customSyntheticUser: ({ coreFields, additionalFields, id }) => ({
        ...coreFields,
        role: "user",
        banned: false,
        banReason: null,
        banExpires: null,
        ...additionalFields,
        id,
      }),
    },
    emailVerification: {
      sendOnSignUp: requireEmailVerification,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        const safeName = escapeHtml(user.name);
        const safeUrl = escapeHtml(url);

        return sendEmail(env, {
          to: user.email,
          subject: "Verify your email - cookclub",
          html: `<p>Hi ${safeName},</p><p>Welcome to cookclub! Please verify your email by clicking the link below:</p><p><a href="${safeUrl}">Verify Email</a></p><p>If you didn't create an account, you can ignore this email.</p>`,
        });
      },
    },
    user: {
      changeEmail: {
        enabled: true,
        sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
          const safeName = escapeHtml(user.name);
          const safeUrl = escapeHtml(url);

          return sendEmail(env, {
            to: newEmail,
            subject: "Verify your new email - cookclub",
            html: `<p>Hi ${safeName},</p><p>You requested to change your email address. Please verify your new email by clicking the link below:</p><p><a href="${safeUrl}">Verify Email</a></p><p>If you didn't request this change, you can ignore this email.</p>`,
          });
        },
      },
    },
    socialProviders: {
      ...googleProvider,
      ...appleProvider,
    },
    account: {
      accountLinking: {
        enabled: true,
      },
    },
  });
}

export type Auth = ReturnType<typeof getAuth>;
export type AuthSession = Auth["$Infer"]["Session"]["session"];
export type AuthUser = Auth["$Infer"]["Session"]["user"];
