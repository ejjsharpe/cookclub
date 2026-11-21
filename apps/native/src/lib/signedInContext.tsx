import { createContext, useContext, useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import {
  setOnboardingPreview,
  useOnboardingPreview,
} from "./onboardingPreview";
import { useSessionContext } from "./sessionContext";

import { useUser } from "@/api/user";
import { Text } from "@/components/Text";

interface SignedInState {
  isSignedIn: boolean;
  onboardingCompleted: boolean;
}

const SignInContext = createContext<SignedInState>({
  isSignedIn: false,
  onboardingCompleted: false,
});

export function useIsSignedIn() {
  const { isSignedIn, onboardingCompleted } = useContext(SignInContext);

  return isSignedIn && onboardingCompleted;
}

export function useIsSignedOut() {
  const { isSignedIn } = useContext(SignInContext);
  return !isSignedIn;
}

export function useNeedsOnboarding() {
  const { isSignedIn, onboardingCompleted } = useContext(SignInContext);

  return isSignedIn && !onboardingCompleted;
}

export const SignedInProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const sessionContext = useSessionContext();
  const isSignedIn = !!sessionContext?.session;
  const { data: userData, isPending: isUserPending } = useUser({
    enabled: isSignedIn,
  });
  const isPreviewingOnboarding = useOnboardingPreview();
  // A preview belongs to the account it started on
  useEffect(() => {
    if (!isSignedIn) setOnboardingPreview(false);
  }, [isSignedIn]);

  if (isSignedIn && isUserPending) {
    return <AuthTransitionScreen />;
  }

  const value: SignedInState = {
    isSignedIn,
    onboardingCompleted:
      (userData?.user?.onboardingCompleted ?? false) && !isPreviewingOnboarding,
  };

  return (
    <SignInContext.Provider value={value}>{children}</SignInContext.Provider>
  );
};

export const AuthTransitionScreen = () => (
  <View style={styles.transitionScreen}>
    <Text type="screenTitle">
      cook
      <Text type="screenTitle" style={styles.clubText}>
        club
      </Text>
    </Text>
    <ActivityIndicator color={styles.activityIndicator.color} />
  </View>
);

const styles = StyleSheet.create((theme) => ({
  transitionScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    backgroundColor: theme.colors.background,
  },
  clubText: {
    color: theme.colors.primary,
  },
  activityIndicator: {
    color: theme.colors.primary,
  },
}));
