import * as AppleAuthentication from "expo-apple-authentication";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

interface SignInWithAppleButtonProps {
  onPress: () => void;
  disabled?: boolean;
}

export const SignInWithAppleButton = ({
  onPress,
  disabled,
}: SignInWithAppleButtonProps) => {
  const [isAvailable, setIsAvailable] = useState(false);

  useEffect(() => {
    let isMounted = true;

    AppleAuthentication.isAvailableAsync()
      .then((available) => {
        if (isMounted) setIsAvailable(available);
      })
      .catch(() => {
        if (isMounted) setIsAvailable(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  if (!isAvailable) return null;

  return (
    <View
      pointerEvents={disabled ? "none" : "auto"}
      style={[styles.container, disabled && styles.disabled]}
    >
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
        cornerRadius={25}
        style={styles.button}
        onPress={onPress}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: "100%",
    height: 50,
  },
  disabled: { opacity: 0.5 },
  button: {
    width: "100%",
    height: 50,
  },
});
