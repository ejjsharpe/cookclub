import { useTRPC } from "@repo/trpc/client";
import { useQueryClient } from "@tanstack/react-query";
import { registerDevMenuItems } from "expo-dev-client";
import { useEffect, useRef } from "react";
import { Alert } from "react-native";

import { useWelcomeOverlay } from "@/components/WelcomeOverlay";
import { setOnboardingPreview } from "@/lib/onboardingPreview";
import { useIsSignedOut } from "@/lib/signedInContext";

/**
 * Development-only entries in the dev client's Tools menu, for checking
 * onboarding and the welcome without making a new account.
 */
export function DevMenuItems() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { showWelcome } = useWelcomeOverlay();
  const isSignedOut = useIsSignedOut();

  // The menu keeps the callbacks it was given, so read the latest values
  const latest = useRef({ isSignedOut, showWelcome });
  latest.current = { isSignedOut, showWelcome };

  useEffect(() => {
    const needsAccount = () => {
      if (!latest.current.isSignedOut) return false;
      Alert.alert("Sign in first", "The previews use the signed-in account.");
      return true;
    };

    const welcome = (withFollows: boolean) => {
      showPreviewWelcome(withFollows).catch((error: unknown) =>
        Alert.alert("Couldn't show the welcome", String(error)),
      );
    };

    const showPreviewWelcome = async (withFollows: boolean) => {
      if (needsAccount()) return;
      const [{ user }, following] = await Promise.all([
        queryClient.fetchQuery(trpc.user.getUser.queryOptions()),
        withFollows
          ? queryClient.fetchQuery(trpc.follows.getFollowing.queryOptions())
          : Promise.resolve([]),
      ]);
      if (!user) return;
      latest.current.showWelcome({
        me: { name: user.name, image: user.image },
        followed: following.map((f) => f.user),
      });
    };

    registerDevMenuItems([
      {
        name: "Preview onboarding",
        callback: () => {
          if (!needsAccount()) setOnboardingPreview(true);
        },
      },
      { name: "Preview welcome", callback: () => welcome(true) },
      {
        name: "Preview welcome, no follows",
        callback: () => welcome(false),
      },
    ]).catch(() => {});
  }, [queryClient, trpc]);

  return null;
}
