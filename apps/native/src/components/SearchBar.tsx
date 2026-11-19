import { useEffect, useRef, type RefObject } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  type TextInputInstance,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Ionicons } from "@/components/Ionicons";

export const SEARCH_BAR_HEIGHT = 44;

interface Props {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  onFocus?: () => void;
  onBlur?: () => void;
  autoFocus?: boolean;
  ref?: RefObject<TextInputInstance | null>;
}

export function SearchBar({
  value,
  onChangeText,
  placeholder = "Search recipes, collections, users...",
  onFocus,
  onBlur,
  autoFocus = false,
  ref,
}: Props) {
  const internalRef = useRef<TextInputInstance>(null);
  const inputRef = ref ?? internalRef;

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus, inputRef]);

  return (
    <View style={styles.container}>
      <Ionicons name="search" size={20} style={styles.searchIcon} />
      <View style={styles.inputContainer}>
        {value.length === 0 && (
          <Text
            style={[styles.inputText, styles.placeholder]}
            numberOfLines={1}
            pointerEvents="none"
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {placeholder}
          </Text>
        )}
        <TextInput
          ref={inputRef}
          style={[styles.inputText, styles.input]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="transparent"
          autoCapitalize="none"
          autoCorrect={false}
          onFocus={onFocus}
          onBlur={onBlur}
        />
      </View>
      {value.length > 0 && (
        <TouchableOpacity
          onPress={() => onChangeText("")}
          style={styles.clearButton}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="close-circle" size={18} style={styles.clearIcon} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: SEARCH_BAR_HEIGHT,
    backgroundColor: theme.colors.inputBackground,
    borderRadius: SEARCH_BAR_HEIGHT / 2,
    paddingHorizontal: 16,
  },
  searchIcon: {
    marginRight: 10,
    color: theme.colors.textTertiary,
  },
  inputContainer: {
    flex: 1,
    minHeight: SEARCH_BAR_HEIGHT,
    justifyContent: "center",
  },
  inputText: {
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.4,
    includeFontPadding: false,
    textAlignVertical: "center",
    color: theme.colors.text,
    fontFamily: theme.fonts.regular,
  },
  input: {
    flex: 1,
    paddingVertical: 0,
  },
  placeholder: {
    position: "absolute",
    right: 0,
    left: 0,
    color: theme.colors.placeholderText,
  },
  clearButton: {
    marginLeft: 8,
  },
  clearIcon: {
    color: theme.colors.textTertiary,
  },
}));
