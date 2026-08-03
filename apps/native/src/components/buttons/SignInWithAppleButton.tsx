import { type PressableProps, View } from "react-native";
import { StyleSheet, UnistylesRuntime } from "react-native-unistyles";

import { BaseButton } from "./BaseButton";
import { Text } from "../Text";
import { AppleLogo } from "../svg/AppleLogo";

interface SignInWithAppleButtonProps {
  onPress: PressableProps["onPress"];
  disabled?: boolean;
}

export const SignInWithAppleButton = ({
  onPress,
  disabled,
}: SignInWithAppleButtonProps) => {
  const { colors } = UnistylesRuntime.getTheme();

  return (
    <BaseButton
      style={[styles.container, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
    >
      <View style={styles.content}>
        <AppleLogo size={20} color={colors.buttonText} />
        <Text style={styles.text}>Sign in with Apple</Text>
      </View>
    </BaseButton>
  );
};

const styles = StyleSheet.create((theme) => ({
  container: {
    backgroundColor: "#000000",
    width: "100%",
    height: 50,
    borderRadius: 25,
    justifyContent: "center",
    alignItems: "center",
  },
  disabled: { opacity: 0.5 },
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  text: {
    fontSize: 17,
    fontFamily: theme.fonts.semiBold,
    color: "#FFFFFF",
  },
}));
