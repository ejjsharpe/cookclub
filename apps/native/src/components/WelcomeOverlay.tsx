import { useTRPC } from "@repo/trpc/client";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useState } from "react";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";

import { Text } from "@/components/Text";

const SPRING = { damping: 20, stiffness: 170, mass: 0.8 };
const FADE_OUT_DURATION = 500;

type WelcomeOverlayContextType = {
  triggerWelcome: () => void;
};

const WelcomeOverlayContext = createContext<WelcomeOverlayContextType>({
  triggerWelcome: () => {},
});

export const useWelcomeOverlay = () => useContext(WelcomeOverlayContext);

export function WelcomeOverlayProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  // Animation shared values
  const overlayOpacity = useSharedValue(0);
  const welcomeOpacity = useSharedValue(0);
  const welcomeTranslateY = useSharedValue(60);
  const cookingOpacity = useSharedValue(0);
  const cookingTranslateY = useSharedValue(60);

  const updateQueryCache = useCallback(() => {
    queryClient.setQueryData(
      trpc.user.getUser.queryFilter().queryKey,
      (old: any) => {
        if (!old) return old;
        return {
          ...old,
          user: { ...old.user, onboardingCompleted: true },
        };
      },
    );
  }, [queryClient, trpc]);

  const unmountOverlay = useCallback(() => {
    setVisible(false);
  }, []);

  const triggerWelcome = useCallback(() => {
    // Reset values
    overlayOpacity.set(0);
    welcomeOpacity.set(0);
    welcomeTranslateY.set(60);
    cookingOpacity.set(0);
    cookingTranslateY.set(60);

    setVisible(true);

    // Overlay fades in, holds, then fades out to reveal tabs
    overlayOpacity.set(
      withSequence(
        withTiming(1, { duration: 300 }),
        withDelay(2900, withTiming(0, { duration: FADE_OUT_DURATION })),
      ),
    );

    // Phase 1 → 2: Welcome text springs in, holds, then springs out
    welcomeOpacity.set(
      withSequence(
        withSpring(1, SPRING),
        withDelay(600, withSpring(0, SPRING)),
      ),
    );
    welcomeTranslateY.set(
      withSequence(
        withSpring(0, SPRING),
        withDelay(600, withSpring(-40, SPRING)),
      ),
    );

    // Phase 2: "Let's get cooking!" springs in after welcome exits (~1800ms)
    cookingOpacity.set(withDelay(1800, withSpring(1, SPRING)));
    cookingTranslateY.set(withDelay(1800, withSpring(0, SPRING)));

    // Phase 3: Update cache so tabs mount underneath (~2600ms)
    setTimeout(() => {
      updateQueryCache();
    }, 2600);

    // Phase 4: Unmount after fade completes
    setTimeout(
      () => {
        unmountOverlay();
      },
      3200 + FADE_OUT_DURATION + 100,
    );
  }, [
    overlayOpacity,
    welcomeOpacity,
    welcomeTranslateY,
    cookingOpacity,
    cookingTranslateY,
    updateQueryCache,
    unmountOverlay,
  ]);

  const welcomeStyle = useAnimatedStyle(() => ({
    opacity: welcomeOpacity.get(),
    transform: [{ translateY: welcomeTranslateY.get() }],
  }));

  const cookingStyle = useAnimatedStyle(() => ({
    opacity: cookingOpacity.get(),
    transform: [{ translateY: cookingTranslateY.get() }],
  }));

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.get(),
  }));

  return (
    <WelcomeOverlayContext.Provider value={{ triggerWelcome }}>
      {children}
      {visible && (
        <Animated.View style={[styles.overlay, overlayStyle]}>
          <Animated.View style={[styles.textGroup, welcomeStyle]}>
            <Text style={styles.welcomeText}>Welcome to</Text>
            <Text style={styles.brandText}>
              cook
              <Text style={[styles.brandText, styles.clubText]}>club</Text>
            </Text>
          </Animated.View>
          <Animated.View style={[styles.textGroup, cookingStyle]}>
            <Text style={styles.cookingText}>Let's get cooking!</Text>
          </Animated.View>
        </Animated.View>
      )}
    </WelcomeOverlayContext.Provider>
  );
}

const styles = StyleSheet.create((theme) => ({
  overlay: {
    ...({
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    } as const),
    backgroundColor: theme.colors.background,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 9999,
  },
  textGroup: {
    position: "absolute",
    alignItems: "center",
  },
  welcomeText: {
    fontSize: 24,
    lineHeight: 24,
    fontFamily: theme.fonts.regular,
    color: theme.colors.text,
    letterSpacing: -1,
    paddingHorizontal: 2,
  },
  brandText: {
    fontSize: 44,
    lineHeight: 54,
    fontFamily: theme.fonts.black,
    color: theme.colors.text,
    letterSpacing: -2.3,
    paddingHorizontal: 6,
  },
  clubText: {
    color: theme.colors.primary,
  },
  cookingText: {
    fontSize: 34,
    lineHeight: 44,
    fontFamily: theme.fonts.black,
    color: theme.colors.text,
    letterSpacing: -1,
    paddingHorizontal: 2,
  },
}));
