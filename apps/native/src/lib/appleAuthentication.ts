import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";

export const isAppleSignInCancellation = (error: unknown) =>
  error instanceof Error &&
  "code" in error &&
  error.code === "ERR_REQUEST_CANCELED";

export const requestAppleSignIn = async () => {
  const nonce = Crypto.randomUUID();
  const credential = await AppleAuthentication.signInAsync({
    nonce,
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
  });

  if (!credential.identityToken) {
    throw new Error("Apple did not return an identity token.");
  }

  const firstName = credential.fullName?.givenName ?? undefined;
  const lastName = credential.fullName?.familyName ?? undefined;
  const email = credential.email ?? undefined;
  const name =
    firstName || lastName
      ? {
          firstName,
          lastName,
        }
      : undefined;

  return {
    token: credential.identityToken,
    nonce,
    ...(name || email
      ? {
          user: {
            name,
            email,
          },
        }
      : {}),
  };
};
