import { useState } from "react";
import { Keyboard } from "react-native";

import { useRequestPasswordReset } from "@/api/auth";
import { Input } from "@/components/Input";
import { VSpace } from "@/components/Space";
import { Text } from "@/components/Text";
import { BaseButton } from "@/components/buttons/BaseButton";
import { PrimaryButton } from "@/components/buttons/PrimaryButton";
import { getEmailError } from "@/lib/sign-up-validation";

export function ForgotPasswordForm({
  initialEmail,
  onBack,
}: {
  initialEmail: string;
  onBack: () => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [emailError, setEmailError] = useState<string>();
  const reset = useRequestPasswordReset();

  const submit = () => {
    if (reset.isPending) return;
    const error = getEmailError(email);
    setEmailError(error);
    if (error) return;
    Keyboard.dismiss();
    reset.mutate(email);
  };

  return (
    <>
      <Text type="title1">
        {reset.isSuccess ? "Check your email" : "Forgot password?"}
      </Text>
      <VSpace size={16} />
      <Text type="bodyFaded" accessibilityLiveRegion="polite">
        {reset.isSuccess
          ? "If an account exists for that email, you'll receive a reset link. Check your spam folder too. The link expires in one hour."
          : "Enter your account email and we'll send you a link to choose a new password."}
      </Text>
      <VSpace size={24} />
      {!reset.isSuccess && (
        <>
          <Input
            label="Email"
            value={email}
            onChangeText={(value) => {
              setEmail(value);
              setEmailError(undefined);
              reset.reset();
            }}
            onBlur={() => setEmailError(getEmailError(email))}
            onSubmitEditing={submit}
            error={emailError}
            editable={!reset.isPending}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            returnKeyType="send"
          />
          {reset.error && (
            <>
              <Text accessibilityRole="alert">{reset.error.message}</Text>
              <VSpace size={16} />
            </>
          )}
          <PrimaryButton disabled={reset.isPending} onPress={submit}>
            {reset.isPending ? "Sending…" : "Send reset link"}
          </PrimaryButton>
        </>
      )}
      {reset.isSuccess && (
        <PrimaryButton onPress={() => reset.reset()}>
          Request another link
        </PrimaryButton>
      )}
      <VSpace size={16} />
      <BaseButton disabled={reset.isPending} onPress={onBack}>
        <Text type="highlight">Back to sign in</Text>
      </BaseButton>
    </>
  );
}
