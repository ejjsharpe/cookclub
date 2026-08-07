const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const MIN_SIGN_UP_PASSWORD_LENGTH = 8;
export const MAX_SIGN_UP_PASSWORD_LENGTH = 128;

export function getEmailError(email: string): string | undefined {
  const value = email.trim();

  if (!value) return "Enter your email address.";
  if (!EMAIL_PATTERN.test(value)) return "Enter a valid email address.";

  return undefined;
}

export function getSignUpPasswordError(password: string): string | undefined {
  if (!password) return "Enter a password.";
  if (password.length < MIN_SIGN_UP_PASSWORD_LENGTH) {
    return `Minimum ${MIN_SIGN_UP_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > MAX_SIGN_UP_PASSWORD_LENGTH) {
    return `Maximum ${MAX_SIGN_UP_PASSWORD_LENGTH} characters.`;
  }

  return undefined;
}

export function getSignInPasswordError(password: string): string | undefined {
  return password ? undefined : "Enter your password.";
}
