import { TrueSheet } from "@lodev09/react-native-true-sheet";
import { useNavigation } from "@react-navigation/native";
import { forwardRef, useState, useImperativeHandle, useRef } from "react";
import { Platform, View, Alert } from "react-native";
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
          <PrimaryButton onPress={onPressSignUpWithEmail}>
            Sign up
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

const styles = StyleSheet.create(() => ({
  content: {
    paddingHorizontal: 24,
    alignItems: "center",
  },
  textAlignCenter: {
    textAlign: "center",
  },
}));
