import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { useState } from "react";
import { View, Alert } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Ionicons } from "@/components/Ionicons";
import { SafeAreaView } from "@/components/SafeAreaView";
import { VSpace } from "@/components/Space";
import { Text } from "@/components/Text";
import { BaseButton } from "@/components/buttons/BaseButton";
import { PrimaryButton } from "@/components/buttons/PrimaryButton";
import { alertApiError } from "@/lib/apiErrorAlert";
import { authClient } from "@/lib/authClient";
import { EMAIL_VERIFICATION_CALLBACK_URL } from "@/lib/emailVerificationCallback";
import type { RootStackParamList } from "@/navigation/navigationRef";

type EmailVerificationRoute = RouteProp<
  RootStackParamList,
  "EmailVerification"
>;

export const EmailVerificationScreen = () => {
  const navigation = useNavigation();
  const route = useRoute<EmailVerificationRoute>();
  const { email } = route.params;
  const [isResending, setIsResending] = useState(false);

  const handleResend = async () => {
    setIsResending(true);
    try {
      const result = await authClient.sendVerificationEmail({
        email,
        callbackURL: EMAIL_VERIFICATION_CALLBACK_URL,
      });
      if (result.error) {
        alertApiError("Verification Failed", result.error, {
          operation: "auth.sendVerificationEmail",
          fallback: "Failed to resend verification email. Please try again.",
        });
      } else {
        Alert.alert("Sent", "A new verification email has been sent.");
      }
    } catch (error) {
      alertApiError("Verification Failed", error, {
        operation: "auth.sendVerificationEmail",
        fallback: "Failed to resend verification email. Please try again.",
      });
    } finally {
      setIsResending(false);
    }
  };

  // Sign-up looks the same for an email that already has an account, and
  // the server emails its owner instead, so offer the way back in here
  const handleSignInInstead = () => {
    navigation.navigate("Start", { signInEmail: email });
  };

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.container}>
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Ionicons name="mail-outline" size={64} style={styles.icon} />
        </View>

        <VSpace size={24} />

        <Text type="title1" style={styles.title}>
          Check your email
        </Text>

        <VSpace size={12} />

        <Text type="bodyFaded" style={styles.subtitle}>
          We sent a verification link to
        </Text>
        <Text type="headline" style={styles.email}>
          {email}
        </Text>

        <VSpace size={8} />

        <Text type="bodyFaded" style={styles.subtitle}>
          Tap the link in it to verify your account. If you already have an
          account, we've emailed you about signing in instead.
        </Text>

        <VSpace size={32} />

        <PrimaryButton onPress={handleResend} disabled={isResending}>
          {isResending ? "Sending..." : "Resend verification email"}
        </PrimaryButton>

        <VSpace size={16} />

        <BaseButton onPress={handleSignInInstead}>
          <Text type="bodyFaded">
            Already have an account? <Text type="highlight">Sign in</Text>
          </Text>
        </BaseButton>
      </View>
    </SafeAreaView>
  );
};
const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  iconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: theme.colors.primary + "20",
    justifyContent: "center",
    alignItems: "center",
  },
  icon: {
    color: theme.colors.primary,
  },
  title: {
    textAlign: "center",
  },
  subtitle: {
    textAlign: "center",
  },
  email: {
    textAlign: "center",
    marginTop: 4,
  },
}));
