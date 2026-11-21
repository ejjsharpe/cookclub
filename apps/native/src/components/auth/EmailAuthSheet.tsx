import type { TrueSheet } from "@lodev09/react-native-true-sheet";
import { useNavigation } from "@react-navigation/native";
import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Keyboard, Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { AuthError, useSignInWithEmail, useSignUpWithEmail } from "@/api/auth";
import { AppSheet } from "@/components/AppSheet";
import { ForgotPasswordForm } from "@/components/ForgotPasswordForm";
import { Input } from "@/components/Input";
import { SystemIcon } from "@/components/SystemIcon";
import { Text } from "@/components/Text";
import { PrimaryButton } from "@/components/buttons/PrimaryButton";
import { alertApiError } from "@/lib/apiErrorAlert";
import { EMAIL_VERIFICATION_CALLBACK_URL } from "@/lib/emailVerificationCallback";
import { isKnownEmail, rememberEmail } from "@/lib/knownEmails";
import { shouldShowEmailVerificationAfterSignUp } from "@/lib/runtimeConfig";
import {
  getEmailError,
  getSignInPasswordError,
  getSignUpPasswordError,
} from "@/lib/sign-up-validation";

export interface EmailAuthSheetRef {
  /** With an email, opens straight on "Welcome back" for it. */
  present: (signInEmail?: string) => void;
}

type Step = "email" | "create" | "signIn" | "forgot";

const TITLES: Record<Step, string> = {
  email: "Continue with email",
  create: "Create a password",
  signIn: "Welcome back",
  forgot: "Reset password",
};

/** 0–4: length first, then a mix of character kinds. */
export function passwordStrength(password: string): number {
  if (password.length < 8) return password ? 1 : 0;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) =>
    re.test(password),
  ).length;
  return Math.min(
    4,
    1 +
      (password.length >= 12 ? 1 : 0) +
      (kinds >= 3 ? 1 : 0) +
      (kinds === 4 ? 1 : 0),
  );
}

/**
 * Email sign-in and sign-up in one sheet. You type your email once; the
 * next step is "Create a password", or "Welcome back" when this phone has
 * signed in with that email before. Either step can switch to the other.
 */
export const EmailAuthSheet = forwardRef<EmailAuthSheetRef>((_, ref) => {
  const { theme } = useUnistyles();
  const navigation = useNavigation();
  const sheetRef = useRef<TrueSheet>(null);
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [emailError, setEmailError] = useState<string>();
  const [passwordError, setPasswordError] = useState<string>();
  const signIn = useSignInWithEmail();
  const signUp = useSignUpWithEmail();
  const isBusy = signIn.isPending || signUp.isPending;

  useImperativeHandle(ref, () => ({
    present: (signInEmail) => {
      if (signInEmail) {
        setEmail(signInEmail);
        setStep("signIn");
      }
      sheetRef.current?.present();
    },
  }));

  const reset = () => {
    setStep("email");
    setPassword("");
    setShowPassword(false);
    setEmailError(undefined);
    setPasswordError(undefined);
  };

  const goTo = (next: Step) => {
    setPassword("");
    setPasswordError(undefined);
    setStep(next);
  };

  const dismiss = () => sheetRef.current?.dismiss() ?? Promise.resolve();
  const normalizedEmail = email.trim();

  const toVerification = async () => {
    await dismiss();
    navigation.navigate("EmailVerification", { email: normalizedEmail });
  };

  const submitEmail = () => {
    const error = getEmailError(email);
    setEmailError(error);
    if (error) return;
    goTo(isKnownEmail(normalizedEmail) ? "signIn" : "create");
  };

  const submitCreate = () => {
    const error = getSignUpPasswordError(password);
    setPasswordError(error);
    if (error || isBusy) return;
    signUp.mutate(
      {
        email: normalizedEmail,
        password,
        callbackURL: EMAIL_VERIFICATION_CALLBACK_URL,
      },
      {
        onSuccess: async () => {
          rememberEmail(normalizedEmail);
          if (shouldShowEmailVerificationAfterSignUp()) {
            await toVerification();
          } else {
            await dismiss();
          }
        },
        onError: async (error) => {
          if (!(error instanceof AuthError)) {
            alertApiError("Couldn't create your account", error, {
              operation: "auth.signUp.email",
              fallback: "Please check your details and try again.",
            });
            return;
          }
          if (error.code === "EMAIL_NOT_VERIFIED") return toVerification();
          if (
            error.code === "USER_ALREADY_EXISTS" ||
            error.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"
          ) {
            goTo("signIn");
            setPasswordError("You already have an account. Sign in instead.");
            return;
          }
          if (error.code === "PASSWORD_TOO_SHORT") {
            return setPasswordError("Use at least 8 characters.");
          }
          if (error.code === "PASSWORD_TOO_LONG") {
            return setPasswordError("Use 128 characters or fewer.");
          }
          if (error.code === "INVALID_PASSWORD") {
            return setPasswordError("Choose a different password.");
          }
          alertApiError("Couldn't create your account", error, {
            operation: "auth.signUp.email",
            fallback: "Please check your details and try again.",
          });
        },
      },
    );
  };

  const submitSignIn = () => {
    const error = getSignInPasswordError(password);
    setPasswordError(error);
    if (error || isBusy) return;
    signIn.mutate(
      { email: normalizedEmail, password },
      {
        onSuccess: async () => {
          rememberEmail(normalizedEmail);
          await dismiss();
        },
        onError: async (error) => {
          if (error instanceof AuthError) {
            if (error.code === "EMAIL_NOT_VERIFIED") return toVerification();
            if (
              error.code === "INVALID_EMAIL_OR_PASSWORD" ||
              error.code === "INVALID_PASSWORD"
            ) {
              return setPasswordError("That email and password don't match.");
            }
          }
          alertApiError("Couldn't sign in", error, {
            operation: "auth.signIn.email",
            fallback: "Please check your details and try again.",
          });
        },
      },
    );
  };

  const strength = passwordStrength(password);
  const passwordInput = (onSubmit: () => void, isNew: boolean) => (
    <Input
      value={password}
      onChangeText={(value) => {
        setPassword(value);
        setPasswordError(undefined);
      }}
      onSubmitEditing={onSubmit}
      error={passwordError}
      placeholder="Password"
      secureTextEntry={!showPassword}
      autoComplete={isNew ? "new-password" : "current-password"}
      textContentType={isNew ? "newPassword" : "password"}
      autoCapitalize="none"
      autoCorrect={false}
      autoFocus
      returnKeyType="go"
      accessibilityLabel="Password"
      rightElement={
        <Pressable
          hitSlop={10}
          onPress={() => setShowPassword((shown) => !shown)}
          accessibilityRole="button"
          accessibilityLabel={showPassword ? "Hide password" : "Show password"}
        >
          <SystemIcon
            sf={showPassword ? "eye.slash" : "eye"}
            android={showPassword ? "eye-off-outline" : "eye-outline"}
            size={18}
            color={theme.colors.textSecondary}
          />
        </Pressable>
      }
    />
  );

  const emailLine = (lead: string) => (
    <Text type="subheadline" style={styles.emailLine}>
      {lead} <Text style={styles.emailStrong}>{normalizedEmail}</Text>
      {" · "}
      <Text
        style={styles.link}
        accessibilityRole="link"
        accessibilityLabel="Change email"
        disabled={isBusy}
        onPress={() => goTo("email")}
      >
        Change
      </Text>
    </Text>
  );

  const switchLink = (question: string, action: string, to: Step) => (
    <Pressable
      onPress={() => goTo(to)}
      hitSlop={8}
      accessibilityRole="button"
      style={styles.switch}
    >
      <Text type="subheadline" style={styles.switchText}>
        {question} <Text style={styles.link}>{action}</Text>
      </Text>
    </Pressable>
  );

  let body: ReactNode;
  if (step === "email") {
    body = (
      <>
        <Input
          value={email}
          onChangeText={(value) => {
            setEmail(value);
            setEmailError(undefined);
          }}
          onSubmitEditing={submitEmail}
          error={emailError}
          placeholder="Email"
          accessibilityLabel="Email"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="next"
          autoFocus
        />
        <PrimaryButton onPress={submitEmail}>Continue</PrimaryButton>
      </>
    );
  } else if (step === "create") {
    body = (
      <>
        {emailLine("New here:")}
        {passwordInput(submitCreate, true)}
        {/* Sits in the space the field keeps for errors */}
        {passwordError ? null : (
          <View
            style={styles.strength}
            accessible
            accessibilityLabel={`Password strength ${strength} of 4`}
          >
            {[1, 2, 3, 4].map((level) => (
              <View
                key={level}
                style={[
                  styles.strengthBar,
                  level <= strength &&
                    (strength >= 3 ? styles.strong : styles.weak),
                ]}
              />
            ))}
          </View>
        )}
        <PrimaryButton onPress={submitCreate} disabled={isBusy}>
          {signUp.isPending ? "Creating account…" : "Create account"}
        </PrimaryButton>
        {switchLink("Already have an account?", "Sign in", "signIn")}
      </>
    );
  } else if (step === "signIn") {
    body = (
      <>
        {emailLine("Signing in as")}
        {passwordInput(submitSignIn, false)}
        <PrimaryButton onPress={submitSignIn} disabled={isBusy}>
          {signIn.isPending ? "Signing in…" : "Sign in"}
        </PrimaryButton>
        <Pressable
          onPress={() => {
            Keyboard.dismiss();
            goTo("forgot");
          }}
          hitSlop={8}
          accessibilityRole="button"
          style={styles.switch}
        >
          <Text type="subheadline" style={styles.link}>
            Forgot password?
          </Text>
        </Pressable>
        {switchLink("New to cookclub?", "Create an account", "create")}
      </>
    );
  } else {
    body = (
      <ForgotPasswordForm
        initialEmail={normalizedEmail}
        onBack={() => goTo("signIn")}
      />
    );
  }

  return (
    <AppSheet
      ref={sheetRef}
      title={TITLES[step]}
      detents={["auto"]}
      onDidDismiss={reset}
    >
      <Pressable
        accessible={false}
        onPress={Keyboard.dismiss}
        style={styles.content}
      >
        {body}
      </Pressable>
    </AppSheet>
  );
});

const styles = StyleSheet.create((theme) => ({
  content: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 4,
  },
  emailLine: {
    textAlign: "center",
    color: theme.colors.textSecondary,
    marginBottom: 14,
  },
  emailStrong: {
    color: theme.colors.text,
    fontFamily: theme.fonts.bold,
  },
  link: {
    color: theme.colors.primary,
    fontFamily: theme.fonts.bold,
  },
  strength: {
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 8,
    marginTop: -14,
    marginBottom: 16,
  },
  strengthBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.inputBackground,
  },
  weak: {
    backgroundColor: "#FF9F0A",
  },
  strong: {
    backgroundColor: "#34C759",
  },
  switch: {
    alignSelf: "center",
    paddingVertical: 10,
  },
  switchText: {
    color: theme.colors.textSecondary,
  },
}));
