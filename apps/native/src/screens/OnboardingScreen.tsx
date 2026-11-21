import { useTRPC } from "@repo/trpc/client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  Keyboard,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";

import { OnboardingStepAbout } from "./onboarding-steps/OnboardingStepAbout";
import {
  OnboardingStepFollowCooks,
  SUGGESTED_COOKS,
} from "./onboarding-steps/OnboardingStepFollowCooks";

import { useFollowing, useSuggestedUsers } from "@/api/follows";
import {
  currentTermsAcceptanceInput,
  useAcceptCurrentTerms,
} from "@/api/legal";
import {
  useCheckUsername,
  useCompleteOnboarding,
  useUpdateProfile,
  useUser,
} from "@/api/user";
import { Text } from "@/components/Text";
import { useWelcomeOverlay } from "@/components/WelcomeOverlay";
import { PrimaryButton } from "@/components/buttons/PrimaryButton";
import { GlassSurface } from "@/components/glass/Glass";
import { GlassCircleButton } from "@/components/glass/GlassCircleButton";
import { useAvatarUpload } from "@/hooks/useAvatarUpload";
import { useDebounce } from "@/hooks/useDebounce";
import { alertApiError } from "@/lib/apiErrorAlert";
import type { MeasurementSystem } from "@/lib/measurementPreferences";
import {
  setOnboardingPreview,
  useOnboardingPreview,
} from "@/lib/onboardingPreview";

const STEPS = 2;
// Follows tapped just before Continue are given this long to land
const FOLLOW_SETTLE_MS = 3000;
const PAGE_SPRING = { damping: 20, stiffness: 170, mass: 0.8 };
const IMPERIAL_REGIONS = new Set(["US", "LR", "MM"]);

/** Metric everywhere except the few places that cook in cups and ounces. */
function unitsForRegion(): MeasurementSystem {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    const region = locale.split(/[-_]/).find((part) => /^[A-Z]{2}$/.test(part));
    return region && IMPERIAL_REGIONS.has(region) ? "imperial" : "metric";
  } catch {
    return "metric";
  }
}

const isMeasurementSystem = (
  value: string | null | undefined,
): value is MeasurementSystem =>
  value === "auto" || value === "metric" || value === "imperial";

/** A small glass capsule of dots; the current one is a longer dash. */
const StepDots = ({ step }: { step: number }) => (
  <GlassSurface style={styles.dots} contentStyle={styles.dotsInner}>
    <View
      style={styles.dotsLabel}
      accessible
      accessibilityLabel={`Step ${step} of ${STEPS}`}
    />
    {Array.from({ length: STEPS }, (_, i) => (
      <View
        key={i}
        style={[
          styles.dot,
          i + 1 === step && styles.dotCurrent,
          i + 1 <= step && styles.dotDone,
        ]}
      />
    ))}
  </GlassSurface>
);

/**
 * Two short steps after sign-up: "About you", then "Follow cooks". Glass
 * controls float over the content; the welcome plays when you finish.
 */
export default function OnboardingScreen() {
  const { width } = useWindowDimensions();
  const { data: userData } = useUser();
  const user = userData?.user;
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: following } = useFollowing();
  // Loads while you fill in step 1, so step 2 opens with them ready
  useSuggestedUsers(SUGGESTED_COOKS);
  const { showWelcome, hideWelcome } = useWelcomeOverlay();
  const completeOnboarding = useCompleteOnboarding();
  const updateProfile = useUpdateProfile();
  const acceptTerms = useAcceptCurrentTerms();
  const { upload: uploadAvatar, isUploading } = useAvatarUpload();

  const [step, setStep] = useState(1);
  // Step 2 stays mounted once reached, so going back doesn't blank it
  const [reachedFollow, setReachedFollow] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [units, setUnits] = useState<MeasurementSystem>(unitsForRegion);
  const hydrated = useRef(false);
  // A development preview: nothing on the About step is saved
  const isPreview = useOnboardingPreview();

  // Fill in what sign-up already knows (Apple and Google give a name)
  useEffect(() => {
    if (!user || hydrated.current) return;
    hydrated.current = true;
    setName(user.name);
    setUsername(user.username ?? "");
    if (
      isMeasurementSystem(user.measurementPreference) &&
      user.measurementPreference !== "auto"
    ) {
      setUnits(user.measurementPreference);
    }
  }, [user]);

  const debouncedUsername = useDebounce(username, 300);
  const {
    data: usernameCheck,
    isFetching: isCheckingUsername,
    isError: usernameCheckFailed,
  } = useCheckUsername(debouncedUsername);
  const isUsernameAvailable =
    debouncedUsername === username ? usernameCheck?.available : undefined;
  // Still typing, or waiting on the server
  const isUsernamePending =
    username.length >= 3 &&
    (debouncedUsername !== username || isCheckingUsername);

  const page = useSharedValue(0);
  const pagerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -page.get() * width }],
  }));
  const back = useSharedValue(0);
  const backStyle = useAnimatedStyle(() => ({
    opacity: back.get(),
    transform: [{ scale: 0.8 + 0.2 * back.get() }],
  }));

  const goTo = (requested: number) => {
    const next = Math.min(STEPS, Math.max(1, requested));
    Keyboard.dismiss();
    if (next === 2) setReachedFollow(true);
    setStep(next);
    page.set(withSpring(next - 1, PAGE_SPRING));
    back.set(withTiming(next > 1 ? 1 : 0, { duration: 200 }));
  };

  const canContinue =
    name.trim().length > 0 &&
    username.length >= 3 &&
    isUsernameAvailable === true;

  const saveAbout = async () => {
    if (!canContinue) {
      setShowErrors(true);
      return;
    }
    if (isPreview) return goTo(2);
    setIsSaving(true);
    try {
      await acceptTerms.mutateAsync(currentTermsAcceptanceInput);
      await updateProfile.mutateAsync({
        username,
        name: name.trim(),
        measurementPreference: units,
      });
      if (profileImage) {
        await uploadAvatar(profileImage);
        setProfileImage(null);
      }
      goTo(2);
    } catch (error) {
      alertApiError("Couldn't save your profile", error, {
        operation: "onboarding.saveProfile",
        fallback: "Please try again.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  /** Who you follow, once any follow you just tapped has landed. */
  const settledFollowing = async () => {
    const filters = { mutationKey: trpc.follows.pathKey() };
    if (queryClient.isMutating(filters)) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(done, FOLLOW_SETTLE_MS);
        const unsubscribe = queryClient.getMutationCache().subscribe(() => {
          if (!queryClient.isMutating(filters)) done();
        });
        function done() {
          clearTimeout(timeout);
          unsubscribe();
          resolve();
        }
      });
    }
    try {
      const list = await queryClient.fetchQuery({
        ...trpc.follows.getFollowing.queryOptions(),
        staleTime: 0,
      });
      return list.map((f) => f.user);
    } catch {
      return (following ?? []).map((f) => f.user);
    }
  };

  const finish = async () => {
    if (isSaving) return;
    Keyboard.dismiss();
    setIsSaving(true);
    try {
      const followed = await settledFollowing();
      const completed = isPreview
        ? Promise.resolve()
        : completeOnboarding.mutateAsync({
            username,
            name: name.trim(),
            measurementPreference: units,
          });
      // The welcome covers the screen first, so Home can mount underneath
      // it. Its button waits until setting up has finished.
      showWelcome({
        me: { name: name.trim() || user?.name || "", image: user?.image },
        followed,
        ready: completed,
      });
      if (isPreview) {
        // Let the welcome cover the screen before leaving onboarding
        setTimeout(() => setOnboardingPreview(false), 200);
        return;
      }
      await completed;
    } catch (error) {
      hideWelcome();
      alertApiError("Couldn't finish setting up", error, {
        operation: "onboarding.complete",
        fallback: "Please try again.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const busy = isSaving || isUploading;

  return (
    <View style={styles.screen}>
      <Animated.View
        style={[styles.pager, { width: width * STEPS }, pagerStyle]}
      >
        <KeyboardAwareScrollView
          style={{ width }}
          accessibilityElementsHidden={step !== 1}
          importantForAccessibility={
            step !== 1 ? "no-hide-descendants" : "auto"
          }
          contentContainerStyle={styles.page}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bottomOffset={110}
        >
          <OnboardingStepAbout
            name={name}
            setName={setName}
            username={username}
            setUsername={setUsername}
            profileImage={profileImage}
            setProfileImage={setProfileImage}
            existingImage={user?.image}
            units={units}
            setUnits={setUnits}
            isCheckingUsername={isCheckingUsername}
            isUsernameAvailable={isUsernameAvailable}
            checkFailed={usernameCheckFailed}
            usernameError={
              usernameCheckFailed
                ? "Couldn't check that username. Try again."
                : (usernameCheck?.reason ?? null)
            }
            showErrors={showErrors}
          />
        </KeyboardAwareScrollView>
        <ScrollView
          style={{ width }}
          contentContainerStyle={styles.page}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          accessibilityElementsHidden={step !== 2}
          importantForAccessibility={
            step !== 2 ? "no-hide-descendants" : "auto"
          }
        >
          {reachedFollow ? <OnboardingStepFollowCooks /> : null}
        </ScrollView>
      </Animated.View>

      <View style={styles.top} pointerEvents="box-none">
        <Animated.View
          style={backStyle}
          pointerEvents={step > 1 ? "auto" : "none"}
          accessibilityElementsHidden={step === 1}
          importantForAccessibility={
            step === 1 ? "no-hide-descendants" : "auto"
          }
        >
          <GlassCircleButton
            icon={{ sf: "chevron.left", android: "chevron-back" }}
            accessibilityLabel="Back"
            onPress={() => goTo(step - 1)}
            size={40}
          />
        </Animated.View>
        <StepDots step={step} />
        <View style={styles.topSpacer} />
      </View>

      <View style={styles.footer} pointerEvents="box-none">
        {step === 1 ? (
          <PrimaryButton onPress={saveAbout} disabled={busy}>
            {busy
              ? "Saving…"
              : isUsernamePending
                ? "Checking username…"
                : "Continue"}
          </PrimaryButton>
        ) : (
          <View style={styles.footerRow}>
            <GlassSurface interactive style={styles.skip}>
              <Pressable
                onPress={finish}
                disabled={busy}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.skipHit,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.skipText}>Skip</Text>
              </Pressable>
            </GlassSurface>
            <View style={styles.continue}>
              <PrimaryButton onPress={finish} disabled={busy}>
                Continue
              </PrimaryButton>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme, rt) => ({
  screen: {
    flex: 1,
    overflow: "hidden",
    backgroundColor: theme.colors.background,
  },
  pager: {
    flex: 1,
    flexDirection: "row",
  },
  page: {
    paddingHorizontal: 24,
    paddingTop: rt.insets.top + 68,
    // Room to scroll the last item above the floating buttons
    paddingBottom: rt.insets.bottom + 110,
  },
  top: {
    position: "absolute",
    top: rt.insets.top + 6,
    left: 16,
    right: 16,
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  topSpacer: {
    width: 40,
  },
  dots: {
    height: 28,
    borderRadius: 14,
  },
  dotsInner: {
    height: 28,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  dotsLabel: {
    ...StyleSheet.absoluteFillObject,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.border,
  },
  dotCurrent: {
    width: 16,
  },
  dotDone: {
    backgroundColor: theme.colors.primary,
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 24,
    paddingTop: 40,
    paddingBottom: rt.insets.bottom + 8,
    experimental_backgroundImage: `linear-gradient(180deg, ${theme.colors.background}00 0%, ${theme.colors.background} 45%)`,
  },
  footerRow: {
    flexDirection: "row",
    gap: 10,
  },
  skip: {
    height: 50,
    borderRadius: 25,
  },
  skipHit: {
    height: 50,
    paddingHorizontal: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  skipText: {
    fontSize: 16,
    fontFamily: theme.fonts.bold,
    color: theme.colors.text,
  },
  pressed: {
    opacity: 0.6,
  },
  continue: {
    flex: 1,
  },
}));
