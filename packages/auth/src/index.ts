import { expo } from "@better-auth/expo";
import { getDb, type DbEnv } from "@repo/db";
import * as schema from "@repo/db/schemas";
import { getOrCreateDefaultCollections } from "@repo/db/services";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { Resend } from "resend";

const FROM_EMAIL = "Cook Club <noreply@cookclub.app>";
const REPLY_TO_EMAIL = "help@cookclub.app";
const AUTH_BASE_PATH = "/auth";
const SOCIAL_PROVIDERS = ["google", "apple"] as const;
type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

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
    console.error("Resend error:", error);
    throw new Error(error.message);
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

export function getAuth(env: AuthEnv) {
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
    database: drizzleAdapter(db, {
      provider: "pg",
      schema,
    }),
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
          subject: "Verify your email - Cook Club",
          html: `<p>Hi ${safeName},</p><p>Welcome to Cook Club! Please verify your email by clicking the link below:</p><p><a href="${safeUrl}">Verify Email</a></p><p>If you didn't create an account, you can ignore this email.</p>`,
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
            subject: "Verify your new email - Cook Club",
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
