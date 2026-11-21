import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { LEGAL_URLS, MINIMUM_ACCOUNT_AGE } from "@repo/contracts";
import { Image } from "expo-image";
import { useEffect, useRef } from "react";
import { Platform, Pressable, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";

import { useSignInWithApple, useSignInWithSocial } from "@/api/auth";
import startImage1 from "@/assets/images/start-food-1.jpg";
import startImage10 from "@/assets/images/start-food-10.jpg";
import startImage11 from "@/assets/images/start-food-11.jpg";
import startImage12 from "@/assets/images/start-food-12.jpg";
import startImage2 from "@/assets/images/start-food-2.jpg";
import startImage3 from "@/assets/images/start-food-3.jpg";
import startImage4 from "@/assets/images/start-food-4.jpg";
import startImage5 from "@/assets/images/start-food-5.jpg";
import startImage6 from "@/assets/images/start-food-6.jpg";
import startImage7 from "@/assets/images/start-food-7.jpg";
import startImage8 from "@/assets/images/start-food-8.jpg";
import startImage9 from "@/assets/images/start-food-9.jpg";
import { Marquee } from "@/components/Marquee";
import { Text } from "@/components/Text";
import {
  EmailAuthSheet,
  type EmailAuthSheetRef,
} from "@/components/auth/EmailAuthSheet";
import { SignInWithAppleButton } from "@/components/buttons/SignInWithAppleButton";
import { SignInWithGoogleButton } from "@/components/buttons/SignInWithGoogleButton";
import { alertApiError } from "@/lib/apiErrorAlert";
import { isAppleSignInCancellation } from "@/lib/appleAuthentication";
import { openExternalWebsite } from "@/lib/externalBrowser";
import type { RootStackParamList } from "@/navigation/navigationRef";

// Three rows drifting at different speeds, the middle one the other way
const ROWS = [
  {
    offset: 0,
    speed: 0.12,
    reverse: false,
    images: [startImage1, startImage2, startImage3, startImage4],
  },
  {
    offset: 22,
    speed: 0.08,
    reverse: true,
    images: [startImage5, startImage6, startImage7, startImage8],
  },
  {
    offset: 64,
    speed: 0.1,
    reverse: false,
    images: [startImage9, startImage10, startImage11, startImage12],
  },
];
const TILE = 112;
const GAP = 8;

/**
 * The first screen: drifting rows of food (still with Reduce Motion), the
 * wordmark, and the ways in.
 * Apple and Google lead; email is one sheet that handles both new and
 * returning accounts.
 */
export default function StartScreen() {
  const emailSheetRef = useRef<EmailAuthSheetRef>(null);
  const reduceMotion = useReducedMotion();
  const navigation = useNavigation();
  const { params } = useRoute<RouteProp<RootStackParamList, "Start">>();
  const signInEmail = params?.signInEmail;

  // Back from "Check your email" with an account that already existed
  useEffect(() => {
    if (!signInEmail) return;
    emailSheetRef.current?.present(signInEmail);
    navigation.setParams({ signInEmail: undefined });
  }, [signInEmail, navigation]);

  const { mutate: signInWithSocial, isPending: isSigningInWithGoogle } =
    useSignInWithSocial();
  const { mutate: signInWithApple, isPending: isSigningInWithApple } =
    useSignInWithApple();

  const onApple = () =>
    signInWithApple(undefined, {
      onError: (error) => {
        if (isAppleSignInCancellation(error)) return;
        alertApiError("Couldn't continue with Apple", error, {
          operation: "auth.signIn.apple",
          fallback: "Please try again.",
        });
      },
    });

  const onGoogle = () =>
    signInWithSocial(
      { provider: "google" },
      {
        onError: (error) =>
          alertApiError("Couldn't continue with Google", error, {
            operation: "auth.signIn.google",
            fallback: "Please try again.",
          }),
      },
    );

  return (
    <View style={styles.screen}>
      <View style={styles.wall} accessibilityElementsHidden>
        {ROWS.map((row, i) => {
          const tiles = (
            <View style={styles.row}>
              {row.images.map((image) => (
                <Image key={image} source={image} style={styles.tile} />
              ))}
            </View>
          );
          return reduceMotion ? (
            <View key={i} style={{ marginLeft: -row.offset }}>
              {tiles}
            </View>
          ) : (
            <Marquee
              key={i}
              offset={row.offset}
              spacing={GAP}
              direction="horizontal"
              speed={row.speed}
              reverse={row.reverse}
            >
              {tiles}
            </Marquee>
          );
        })}
        <View style={styles.fade} />
      </View>

      <View style={styles.intro}>
        <Text style={styles.wordmark} accessibilityRole="header">
          cook<Text style={[styles.wordmark, styles.club]}>club</Text>
        </Text>
        <Text style={styles.tagline}>
          Save recipes from anywhere, plan the week, and cook with friends.
        </Text>
      </View>

      <View style={styles.actions}>
        {Platform.OS === "ios" && (
          <SignInWithAppleButton
            disabled={isSigningInWithApple}
            onPress={onApple}
          />
        )}
        <SignInWithGoogleButton
          disabled={isSigningInWithGoogle}
          onPress={onGoogle}
        />
        <Pressable
          onPress={() => emailSheetRef.current?.present()}
          accessibilityRole="button"
          style={({ pressed }) => [styles.email, pressed && styles.pressed]}
        >
          <Text style={styles.emailText}>Continue with email</Text>
        </Pressable>
        <Text type="caption1" style={styles.legal}>
          By continuing you confirm you're at least {MINIMUM_ACCOUNT_AGE} and
          agree to the{" "}
          <Text
            type="caption1"
            accessibilityRole="link"
            onPress={() => openExternalWebsite(LEGAL_URLS.terms)}
            style={styles.legalLink}
          >
            Terms
          </Text>{" "}
          and{" "}
          <Text
            type="caption1"
            accessibilityRole="link"
            onPress={() => openExternalWebsite(LEGAL_URLS.privacy)}
            style={styles.legalLink}
          >
            Privacy Policy
          </Text>
          .
        </Text>
      </View>

      <EmailAuthSheet ref={emailSheetRef} />
    </View>
  );
}

const styles = StyleSheet.create((theme, rt) => ({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  wall: {
    paddingTop: rt.insets.top - 14,
    gap: GAP,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    gap: GAP,
  },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: 22,
  },
  fade: {
    ...StyleSheet.absoluteFillObject,
    experimental_backgroundImage: `linear-gradient(180deg, ${theme.colors.background}00 45%, ${theme.colors.background} 100%)`,
  },
  intro: {
    flex: 1,
    paddingHorizontal: 32,
    paddingTop: 20,
    alignItems: "center",
  },
  wordmark: {
    fontSize: 32,
    lineHeight: 40,
    fontFamily: theme.fonts.black,
    letterSpacing: -1.6,
    color: theme.colors.text,
  },
  club: {
    color: theme.colors.primary,
  },
  tagline: {
    marginTop: 8,
    maxWidth: 300,
    textAlign: "center",
    fontSize: 16,
    lineHeight: 22,
    color: theme.colors.textSecondary,
  },
  actions: {
    paddingHorizontal: 24,
    paddingBottom: rt.insets.bottom + 8,
    gap: 10,
  },
  email: {
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.6,
  },
  emailText: {
    fontSize: 16,
    fontFamily: theme.fonts.bold,
    color: theme.colors.text,
  },
  legal: {
    textAlign: "center",
    color: theme.colors.textSecondary,
  },
  legalLink: {
    color: theme.colors.textSecondary,
    fontFamily: theme.fonts.semiBold,
    textDecorationLine: "underline",
  },
}));
