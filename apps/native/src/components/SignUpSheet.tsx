import { TrueSheet } from "@lodev09/react-native-true-sheet";
import { useNavigation } from "@react-navigation/native";
import { LEGAL_URLS, MINIMUM_ACCOUNT_AGE } from "@repo/contracts";
import { forwardRef, useState, useImperativeHandle, useRef } from "react";
import { Platform, View } from "react-native";
import { StyleSheet, UnistylesRuntime } from "react-native-unistyles";

import { useSignUpWithEmail, useSignInWithSocial, AuthError } from "@/api/auth";
import { Input } from "@/components/Input";
import { VSpace } from "@/components/Space";
import { Text } from "@/components/Text";
import { BaseButton } from "@/components/buttons/BaseButton";
import { PrimaryButton } from "@/components/buttons/PrimaryButton";
import { SignInWithAppleButton } from "@/components/buttons/SignInWithAppleButton";
import { SignInWithGoogleButton } from "@/components/buttons/SignInWithGoogleButton";
import { alertApiError } from "@/lib/apiErrorAlert";
import { openExternalWebsite } from "@/lib/externalBrowser";
import { shouldShowEmailVerificationAfterSignUp } from "@/lib/runtimeConfig";
import {
  getEmailError,
  getSignUpPasswordError,
} from "@/lib/sign-up-validation";

export interface SignUpSheetProps {
  onSwitchToSignIn?: () => void;
}

export interface SignUpSheetRef {
  present: () => void;
  dismiss: () => Promise<void>;
}

export const SignUpSheet = forwardRef<SignUpSheetRef, SignUpSheetProps>(
  ({ onSwitchToSignIn }, ref) => {
    const theme = UnistylesRuntime.getTheme();
    const navigation = useNavigation();
    const sheetRef = useRef<TrueSheet>(null);
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [emailError, setEmailError] = useState<string>();
    const [passwordError, setPasswordError] = useState<string>();
    const { mutate: signUpWithEmail, isPending: isSigningUpWithEmail } =
      useSignUpWithEmail();
    const { mutate: signInWithSocial } = useSignInWithSocial();

    useImperativeHandle(ref, () => ({
      present: () => sheetRef.current?.present(),
      dismiss: () => sheetRef.current?.dismiss() ?? Promise.resolve(),
    }));

    const dismissSheet = () => sheetRef.current?.dismiss() ?? Promise.resolve();

    const onChangeEmail = (value: string) => {
      setEmail(value);
      setEmailError(undefined);
    };

    const onChangePassword = (value: string) => {
      setPassword(value);
      setPasswordError(undefined);
    };

    const onPressSignUpWithEmail = () => {
      const normalizedEmail = email.trim();
      const nextEmailError = getEmailError(email);
      const nextPasswordError = getSignUpPasswordError(password);

      setEmailError(nextEmailError);
      setPasswordError(nextPasswordError);

      if (nextEmailError || nextPasswordError) return;

      signUpWithEmail(
        { email: normalizedEmail, password },
        {
          onSuccess: async () => {
            await dismissSheet();
            if (shouldShowEmailVerificationAfterSignUp()) {
              navigation.navigate("EmailVerification", {
                email: normalizedEmail,
              });
            }
          },
          onError: async (error) => {
            if (
              error instanceof AuthError &&
              error.code === "EMAIL_NOT_VERIFIED"
            ) {
              // Email not verified — send them to verification
              await dismissSheet();
              navigation.navigate("EmailVerification", {
                email: normalizedEmail,
              });
              return;
            }

            if (error instanceof AuthError) {
              if (
                error.code === "USER_ALREADY_EXISTS" ||
                error.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"
              ) {
                setEmailError("Account already exists.");
                return;
              }

              if (error.code === "PASSWORD_TOO_SHORT") {
                setPasswordError("Minimum 8 characters.");
                return;
              }

              if (error.code === "PASSWORD_TOO_LONG") {
                setPasswordError("Maximum 128 characters.");
                return;
              }

              if (error.code === "INVALID_PASSWORD") {
                setPasswordError("Choose a different password.");
                return;
              }
            }

            alertApiError("Sign Up Failed", error, {
              operation: "auth.signUp.email",
              fallback: "Please check your details and try again.",
            });
          },
        },
      );
    };

    const onPressSignIn = async () => {
      await dismissSheet();
      onSwitchToSignIn?.();
    };

    const onPressSignInWithSocial = (provider: "google" | "apple") => {
      signInWithSocial(
        { provider },
        {
          onSuccess: dismissSheet,
          onError: (error) =>
            alertApiError("Sign In Failed", error, {
              operation: `auth.signIn.${provider}`,
              fallback: "Social sign in failed. Please try again.",
            }),
        },
      );
    };

    return (
      <TrueSheet
        ref={sheetRef}
        detents={["auto"]}
        grabber={false}
        backgroundColor={theme.colors.background}
      >
        <View style={styles.content}>
          <VSpace size={24} />
          <Text type="title1">Sign up</Text>
          <VSpace size={12} />
          <Text style={styles.textAlignCenter} type="bodyFaded">
            Sign up now to find your next favourite meal.
          </Text>
          <VSpace size={32} />
          <Input
            label="Email"
            autoComplete="email"
            value={email}
            onChangeText={onChangeEmail}
            onBlur={() => setEmailError(getEmailError(email))}
            error={emailError}
            placeholder="gordon@superchef.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
          />
          <Input
            label="Password"
            autoComplete="new-password"
            value={password}
            onChangeText={onChangePassword}
            onBlur={() => setPasswordError(getSignUpPasswordError(password))}
            onSubmitEditing={onPressSignUpWithEmail}
            error={passwordError}
            placeholder="••••••••••••"
            secureTextEntry
            returnKeyType="go"
          />
          <Text type="caption1" style={styles.legalCopy}>
            By creating an account, you confirm that you’re at least{" "}
            {MINIMUM_ACCOUNT_AGE} and agree to our{" "}
            <Text
              type="caption1"
              accessibilityRole="link"
              onPress={() => openExternalWebsite(LEGAL_URLS.terms)}
              style={styles.legalLink}
            >
              Terms of Service
            </Text>
            . See our{" "}
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
          <VSpace size={16} />
          <PrimaryButton
            disabled={isSigningUpWithEmail}
            onPress={onPressSignUpWithEmail}
          >
            {isSigningUpWithEmail ? "Signing up…" : "Sign up"}
          </PrimaryButton>
          <VSpace size={12} />
          <Text type="bodyFaded" style={styles.textAlignCenter}>
            or
          </Text>
          <VSpace size={12} />
          {Platform.OS === "ios" && (
            <SignInWithAppleButton
              onPress={() => onPressSignInWithSocial("apple")}
            />
          )}
          {Platform.OS === "ios" && <VSpace size={12} />}
          <SignInWithGoogleButton
            onPress={() => onPressSignInWithSocial("google")}
          />
          <VSpace size={32} />
          <BaseButton onPress={onPressSignIn}>
            <Text>
              Already have an account? <Text type="highlight">Sign in</Text>
            </Text>
          </BaseButton>
        </View>
      </TrueSheet>
    );
  },
);

const styles = StyleSheet.create((theme) => ({
  content: {
    paddingHorizontal: 24,
    alignItems: "center",
  },
  textAlignCenter: {
    textAlign: "center",
  },
  legalCopy: {
    width: "100%",
    color: theme.colors.textSecondary,
    textAlign: "center",
  },
  legalLink: {
    color: theme.colors.textSecondary,
    fontFamily: theme.fonts.semiBold,
    textDecorationLine: "underline",
  },
}));
