import { TrueSheet } from "@lodev09/react-native-true-sheet";
import { useNavigation } from "@react-navigation/native";
import { forwardRef, useState, useImperativeHandle, useRef } from "react";
import { Platform, View } from "react-native";
import { StyleSheet, UnistylesRuntime } from "react-native-unistyles";

import {
  useSignInWithApple,
  useSignInWithEmail,
  useSignInWithSocial,
  AuthError,
} from "@/api/auth";
import { Input } from "@/components/Input";
import { VSpace } from "@/components/Space";
import { Text } from "@/components/Text";
import { BaseButton } from "@/components/buttons/BaseButton";
import { PrimaryButton } from "@/components/buttons/PrimaryButton";
import { SignInWithAppleButton } from "@/components/buttons/SignInWithAppleButton";
import { SignInWithGoogleButton } from "@/components/buttons/SignInWithGoogleButton";
import { alertApiError } from "@/lib/apiErrorAlert";
import { isAppleSignInCancellation } from "@/lib/appleAuthentication";
import {
  getEmailError,
  getSignInPasswordError,
} from "@/lib/sign-up-validation";

export interface SignInSheetProps {
  onSwitchToSignUp?: () => void;
}

export interface SignInSheetRef {
  present: () => void;
  dismiss: () => Promise<void>;
}

export const SignInSheet = forwardRef<SignInSheetRef, SignInSheetProps>(
  ({ onSwitchToSignUp }, ref) => {
    const theme = UnistylesRuntime.getTheme();
    const navigation = useNavigation();
    const sheetRef = useRef<TrueSheet>(null);
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [emailError, setEmailError] = useState<string>();
    const [passwordError, setPasswordError] = useState<string>();
    const [credentialError, setCredentialError] = useState<string>();
    const { mutate: signInWithEmail, isPending: isSigningInWithEmail } =
      useSignInWithEmail();
    const { mutate: signInWithSocial } = useSignInWithSocial();
    const { mutate: signInWithApple, isPending: isSigningInWithApple } =
      useSignInWithApple();

    useImperativeHandle(ref, () => ({
      present: () => sheetRef.current?.present(),
      dismiss: () => sheetRef.current?.dismiss() ?? Promise.resolve(),
    }));

    const dismissSheet = () => sheetRef.current?.dismiss() ?? Promise.resolve();

    const onChangeEmail = (value: string) => {
      setEmail(value);
      setEmailError(undefined);
      setCredentialError(undefined);
    };

    const onChangePassword = (value: string) => {
      setPassword(value);
      setPasswordError(undefined);
      setCredentialError(undefined);
    };

    const onPressSignInWithEmail = () => {
      const normalizedEmail = email.trim();
      const nextEmailError = getEmailError(email);
      const nextPasswordError = getSignInPasswordError(password);

      setEmailError(nextEmailError);
      setPasswordError(nextPasswordError);
      setCredentialError(undefined);

      if (nextEmailError || nextPasswordError) return;

      signInWithEmail(
        { email: normalizedEmail, password },
        {
          onSuccess: dismissSheet,
          onError: async (error) => {
            if (
              error instanceof AuthError &&
              error.code === "EMAIL_NOT_VERIFIED"
            ) {
              await dismissSheet();
              navigation.navigate("EmailVerification", {
                email: normalizedEmail,
              });
              return;
            }

            if (
              error instanceof AuthError &&
              (error.code === "INVALID_EMAIL_OR_PASSWORD" ||
                error.code === "INVALID_PASSWORD")
            ) {
              setCredentialError("Incorrect email or password.");
              return;
            }

            alertApiError("Sign In Failed", error, {
              operation: "auth.signIn.email",
              fallback: "Please check your details and try again.",
            });
          },
        },
      );
    };

    const onPressSignUp = async () => {
      await dismissSheet();
      onSwitchToSignUp?.();
    };

    const onPressSignInWithSocial = (provider: "google") => {
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

    const onPressSignInWithApple = () => {
      signInWithApple(undefined, {
        onSuccess: dismissSheet,
        onError: (error) => {
          if (isAppleSignInCancellation(error)) return;

          alertApiError("Sign In Failed", error, {
            operation: "auth.signIn.apple",
            fallback: "Apple sign in failed. Please try again.",
          });
        },
      });
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
          <Text type="title1">Sign in</Text>
          <VSpace size={12} />
          <Text style={styles.textAlignCenter} type="bodyFaded">
            Lets get cooking! Your next meal is only minutes away...
          </Text>
          <VSpace size={32} />
          <Input
            label="Email"
            value={email}
            onChangeText={onChangeEmail}
            onBlur={() => setEmailError(getEmailError(email))}
            error={emailError}
            placeholder="gordon@superchef.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
          />
          <Input
            label="Password"
            value={password}
            onChangeText={onChangePassword}
            onBlur={() => setPasswordError(getSignInPasswordError(password))}
            onSubmitEditing={onPressSignInWithEmail}
            error={passwordError ?? credentialError}
            placeholder="••••••••••••"
            secureTextEntry
            autoComplete="password"
            returnKeyType="go"
          />
          <PrimaryButton
            disabled={isSigningInWithEmail}
            onPress={onPressSignInWithEmail}
          >
            {isSigningInWithEmail ? "Signing in…" : "Sign in"}
          </PrimaryButton>
          <VSpace size={12} />
          <Text type="bodyFaded" style={styles.textAlignCenter}>
            or
          </Text>
          <VSpace size={12} />
          {Platform.OS === "ios" && (
            <SignInWithAppleButton
              disabled={isSigningInWithApple}
              onPress={onPressSignInWithApple}
            />
          )}
          {Platform.OS === "ios" && <VSpace size={12} />}
          <SignInWithGoogleButton
            onPress={() => onPressSignInWithSocial("google")}
          />
          <VSpace size={32} />
          <BaseButton onPress={onPressSignUp}>
            <Text>
              Don't have an account yet? <Text type="highlight">Sign up</Text>
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
