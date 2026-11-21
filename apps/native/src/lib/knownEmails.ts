import { storage } from "./mmkv";

// Emails that have signed in on this device, so "Continue with email" can
// open on the sign-in step for them and on "Create a password" for anyone
// else. The server never says whether an email has an account.
const KEY = "known_sign_in_emails";
const MAX = 5;

const normalise = (email: string) => email.trim().toLowerCase();

function read(): string[] {
  try {
    const parsed: unknown = JSON.parse(storage.getString(KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

export function isKnownEmail(email: string): boolean {
  return read().includes(normalise(email));
}

/** After deleting the account, so the sheet no longer says "Welcome back". */
export function forgetEmail(email: string): void {
  const value = normalise(email);
  storage.set(KEY, JSON.stringify(read().filter((x) => x !== value)));
}

export function rememberEmail(email: string): void {
  const value = normalise(email);
  if (!value) return;
  const next = [value, ...read().filter((x) => x !== value)].slice(0, MAX);
  storage.set(KEY, JSON.stringify(next));
}
