import { useTRPC } from "@repo/trpc/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { requestAppleSignIn } from "@/lib/appleAuthentication";
import { authClient } from "@/lib/authClient";
import {
  resolvePublicError,
  type ResolvedPublicError,
} from "@/lib/publicError";
import { getCurrentExpoPushToken } from "@/lib/pushNotifications";
import { getPasswordResetUrl } from "@/lib/runtimeConfig";
import { clearLocalSessionState } from "@/lib/sessionCleanup";

export class AuthError extends Error {
  code: ResolvedPublicError["code"];
  requestId?: string;
  constructor(error: ResolvedPublicError) {
    super(error.message);
    this.name = "AuthError";
    this.code = error.code;
    this.requestId = error.requestId;
  }
}

export const useSignInWithEmail = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      email,
      password,
    }: {
      email: string;
      password: string;
    }) => {
      const result = await authClient.signIn.email({ email, password });
      if (result.error) {
        throw new AuthError(
          resolvePublicError(result.error, "Sign in failed."),
        );
      }
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
    },
  });
};

export const useRequestPasswordReset = () =>
  useMutation({
    mutationFn: async (email: string) => {
      const result = await authClient.requestPasswordReset({
        email: email.trim(),
        redirectTo: getPasswordResetUrl(),
      });
      if (result.error) {
        throw new AuthError(
          resolvePublicError(
            result.error,
            "We couldn't request a reset link. Please try again.",
          ),
        );
      }
      return result.data;
    },
  });

export const useSignUpWithEmail = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      email,
      password,
      callbackURL,
    }: {
      email: string;
      password: string;
      callbackURL: string;
    }) => {
      const result = await authClient.signUp.email({
        email,
        password,
        name: "",
        callbackURL,
      });
      if (result.error) {
        throw new AuthError(
          resolvePublicError(result.error, "Sign up failed."),
        );
      }
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
    },
  });
};

export const useSignInWithSocial = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ provider }: { provider: "google" }) => {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: "/",
      });
      if (result.error) {
        throw new AuthError(
          resolvePublicError(result.error, "Social sign in failed."),
        );
      }
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
    },
  });
};

export const useSignInWithApple = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const idToken = await requestAppleSignIn();
      const result = await authClient.signIn.social({
        provider: "apple",
        idToken,
      });
      if (result.error) {
        throw new AuthError(
          resolvePublicError(result.error, "Apple sign in failed."),
        );
      }
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
    },
  });
};

export const useSignOut = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const unregisterPushToken = useMutation(
    trpc.notification.unregisterPushToken.mutationOptions(),
  );

  return useMutation({
    mutationFn: async () => {
      try {
        const token = await getCurrentExpoPushToken();

        if (token) {
          await unregisterPushToken.mutateAsync({ token });
        }
      } catch (error) {
        console.warn("Failed to unregister push notifications", error);
      }

      const result = await authClient.signOut();
      if (result.error) {
        throw new AuthError(
          resolvePublicError(result.error, "Sign out failed."),
        );
      }
      return result.data;
    },
    onSettled: async () => {
      await clearLocalSessionState(queryClient);
    },
  });
};
