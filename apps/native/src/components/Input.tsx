import {
  TextInput,
  TextInputProps,
  View,
  type TextInputInstance,
} from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";

import { Text } from "./Text";

const ERROR_ENTERING = FadeIn.duration(160);
const ERROR_EXITING = FadeOut.duration(100);

interface Props extends TextInputProps {
  ref?: React.Ref<TextInputInstance>;
  label?: string;
  rightElement?: React.ReactNode;
  error?: string;
}

export const Input = (inputProps: Props) => {
  const reservesErrorSpace = Object.hasOwn(inputProps, "error");
  const {
    label,
    style,
    rightElement,
    error,
    accessibilityHint,
    accessibilityLabel,
    ...props
  } = inputProps;

  return (
    <View style={styles.container}>
      {!!label && <Text style={styles.label}>{label}</Text>}
      <View style={styles.inputRow}>
        <TextInput
          style={[
            styles.input,
            rightElement ? styles.inputWithRight : undefined,
            error ? styles.inputError : undefined,
            style,
          ]}
          accessibilityLabel={accessibilityLabel ?? label}
          accessibilityHint={error ?? accessibilityHint}
          placeholderTextColor={styles.placeholder.color}
          {...props}
        />
        {rightElement && (
          <View style={styles.rightElement}>{rightElement}</View>
        )}
      </View>
      {reservesErrorSpace ? (
        <View style={styles.reservedError}>
          {error ? (
            <Animated.View entering={ERROR_ENTERING} exiting={ERROR_EXITING}>
              <Text
                type="footnote"
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                numberOfLines={1}
                selectable
                style={styles.error}
              >
                {error}
              </Text>
            </Animated.View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create((theme) => ({
  container: {
    width: "100%",
  },
  label: {
    marginBottom: 8,
    marginLeft: 16,
    fontSize: 15,
    color: theme.colors.text,
  },
  inputRow: {
    position: "relative",
    width: "100%",
  },
  input: {
    width: "100%",
    height: 50,
    paddingHorizontal: 20,
    paddingVertical: 0,
    borderRadius: 25,
    backgroundColor: theme.colors.inputBackground,
    fontFamily: theme.fonts.regular,
    fontSize: 17,
    color: theme.colors.text,
  },
  inputError: {
    borderWidth: 1,
    borderColor: theme.colors.destructive,
  },
  inputWithRight: {
    paddingRight: 48,
  },
  rightElement: {
    position: "absolute",
    right: 16,
    top: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  placeholder: {
    color: theme.colors.placeholderText,
  },
  error: {
    marginTop: 4,
    marginLeft: 16,
    color: theme.colors.destructive,
  },
  reservedError: {
    height: 24,
    overflow: "hidden",
  },
}));
