import { parseMentionTokens } from "@repo/shared";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import {
  Text,
  TextInput,
  View,
  type TextInputProps,
  type TextInputScrollEvent,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { SEARCH_BAR_HEIGHT } from "@/components/SearchBar";

type MentionTextInputProps = Omit<
  TextInputProps,
  "children" | "style" | "value"
> & {
  ref?: Ref<TextInput>;
  value: string;
  taggedUsernames: ReadonlySet<string>;
};

export function MentionTextInput({
  ref,
  value,
  taggedUsernames,
  onScroll,
  ...props
}: MentionTextInputProps) {
  const [scrollOffsetY, setScrollOffsetY] = useState(0);

  useEffect(() => {
    if (value.length === 0) setScrollOffsetY(0);
  }, [value]);

  const highlightedContent = useMemo<ReactNode>(() => {
    const content: ReactNode[] = [];
    let cursor = 0;

    for (const token of parseMentionTokens(value)) {
      if (!taggedUsernames.has(token.username)) continue;

      if (cursor < token.start) {
        content.push(value.slice(cursor, token.start));
      }
      content.push(
        <Text key={`${token.username}-${token.start}`} style={styles.mention}>
          {value.slice(token.start, token.end)}
        </Text>,
      );
      cursor = token.end;
    }

    if (cursor < value.length) content.push(value.slice(cursor));
    return content.length > 0 ? content : value;
  }, [taggedUsernames, value]);

  const handleScroll = useCallback(
    (event: TextInputScrollEvent) => {
      setScrollOffsetY(event.nativeEvent.contentOffset.y);
      onScroll?.(event);
    },
    [onScroll],
  );

  return (
    <View style={styles.container}>
      {value.length > 0 ? (
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={[
            styles.highlightedText,
            { transform: [{ translateY: -scrollOffsetY }] },
          ]}
        >
          {highlightedContent}
        </Text>
      ) : null}
      <TextInput
        {...props}
        ref={ref}
        value={value}
        onScroll={handleScroll}
        style={styles.input}
      />
    </View>
  );
}

const sharedTextStyle = {
  paddingHorizontal: 14,
  paddingVertical: 10,
  fontSize: 17,
  lineHeight: 22,
  includeFontPadding: false,
  textAlignVertical: "center" as const,
};

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    maxHeight: 110,
    minHeight: SEARCH_BAR_HEIGHT,
    borderRadius: SEARCH_BAR_HEIGHT / 2,
    borderCurve: "continuous",
    overflow: "hidden",
    backgroundColor: theme.colors.inputBackground,
  },
  highlightedText: {
    ...sharedTextStyle,
    position: "absolute",
    top: 0,
    right: 0,
    left: 0,
    color: theme.colors.text,
    fontFamily: theme.fonts.regular,
  },
  mention: {
    color: theme.colors.primary,
    // Keep the same glyph advances as the native input so its caret remains
    // aligned. The zero-offset shadow adds weight without affecting layout.
    fontFamily: theme.fonts.regular,
    textShadowColor: theme.colors.primary,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 0.6,
  },
  input: {
    ...sharedTextStyle,
    zIndex: 1,
    width: "100%",
    maxHeight: 110,
    minHeight: SEARCH_BAR_HEIGHT,
    color: "transparent",
    fontFamily: theme.fonts.regular,
  },
}));
