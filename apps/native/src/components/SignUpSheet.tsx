import { TrueSheet } from "@lodev09/react-native-true-sheet";
import { useNavigation } from "@react-navigation/native";
import { LEGAL_URLS, MINIMUM_ACCOUNT_AGE } from "@repo/contracts";
import * as Linking from "expo-linking";
import { forwardRef, useState, useImperativeHandle, useRef } from "react";
import { Platform, View, Alert, Pressable } from "react-native";
import { StyleSheet, UnistylesRuntime } from "react-native-unistyles";

import { useSignUpWithEmail, useSignInWithSocial, AuthError } from "@/api/auth";
import { Input } from "@/components/Input";
import { Ionicons } from "@/components/Ionicons";
import { VSpace } from "@/components/Space";
import { Text } from "@/components/Text";
import { BaseButton } from "@/components/buttons/BaseButton";
import { PrimaryButton } from "@/components/buttons/PrimaryButton";
import { SignInWithAppleButton } from "@/components/buttons/SignInWithAppleButton";
import { SignInWithGoogleButton } from "@/components/buttons/SignInWithGoogleButton";
import { alertApiError } from "@/lib/apiErrorAlert";
import { shouldShowEmailVerificationAfterSignUp } from "@/lib/runtimeConfig";

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
    const [acceptedTerms, setAcceptedTerms] = useState(false);
    const { mutate: signUpWithEmail } = useSignUpWithEmail();
    const { mutate: signInWithSocial } = useSignInWithSocial();

    useImperativeHandle(ref, () => ({
      present: () => sheetRef.current?.present(),
      dismiss: () => sheetRef.current?.dismiss() ?? Promise.resolve(),
    }));

    const dismissSheet = () => sheetRef.current?.dismiss() ?? Promise.resolve();

    const onPressSignUpWithEmail = () =>
      signUpWithEmail(
        { email, password },
        {
          onSuccess: async () => {
            await dismissSheet();
            if (shouldShowEmailVerificationAfterSignUp()) {
              navigation.navigate("EmailVerification", { email });
            }
          },
          onError: async (error) => {
            if (
              error instanceof AuthError &&
              error.code === "EMAIL_NOT_VERIFIED"
            ) {
              // Email not verified — send them to verification
              await dismissSheet();
              navigation.navigate("EmailVerification", { email });
            } else if (
              error instanceof AuthError &&
              (error.code === "USER_ALREADY_EXISTS" ||
                error.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL")
            ) {
              Alert.alert(
                "Account Exists",
                "An account with this email already exists. Please sign in instead.",
              );
            } else {
              alertApiError("Sign Up Failed", error, {
                operation: "auth.signUp.email",
                fallback: "Please check your details and try again.",
              });
            }
          },
        },
      );

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
            onChangeText={setEmail}
            placeholder="gordon@superchef.com"
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <VSpace size={12} />
          <Input
            label="Password"
            autoComplete="new-password"
            onChangeText={setPassword}
            placeholder="••••••••••••"
            secureTextEntry
          />
          <VSpace size={12} />
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: acceptedTerms }}
            onPress={() => setAcceptedTerms((accepted) => !accepted)}
            style={styles.termsRow}
          >
            <Ionicons
              name={acceptedTerms ? "checkbox" : "square-outline"}
              size={24}
              style={acceptedTerms ? styles.termsChecked : styles.termsIcon}
            />
            <Text type="caption" style={styles.termsCopy}>
              I confirm I am at least {MINIMUM_ACCOUNT_AGE} and accept the Terms
              of Service and Privacy Policy.
            </Text>
          </Pressable>
          <View style={styles.legalLinks}>
            <Pressable onPress={() => Linking.openURL(LEGAL_URLS.terms)}>
              <Text type="highlight">Terms of Service</Text>
            </Pressable>
            <Text type="bodyFaded">·</Text>
            <Pressable onPress={() => Linking.openURL(LEGAL_URLS.privacy)}>
              <Text type="highlight">Privacy Policy</Text>
            </Pressable>
          </View>
          <VSpace size={16} />
          <PrimaryButton
            disabled={!acceptedTerms}
            onPress={onPressSignUpWithEmail}
          >
            Sign up
          </PrimaryButton>
          <VSpace size={12} />
          <Text type="bodyFaded" style={styles.textAlignCenter}>
            or
          </Text>
          <VSpace size={12} />
          {Platform.OS === "ios" && (
            <SignInWithAppleButton
              disabled={!acceptedTerms}
              onPress={() => onPressSignInWithSocial("apple")}
            />
          )}
          {Platform.OS === "ios" && <VSpace size={12} />}
          <SignInWithGoogleButton
            disabled={!acceptedTerms}
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
  termsRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  termsCopy: { flex: 1 },
  termsIcon: { color: "#888888" },
  termsChecked: { color: theme.colors.primary },
  legalLinks: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
}));
