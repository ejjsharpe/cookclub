import { useState, useMemo, useRef } from "react";
import {
  View,
  TextInput,
  Pressable,
  type TextInputInstance,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Text } from "./Text";

import { useUserTags } from "@/api/recipe";
import { Ionicons } from "@/components/Ionicons";

interface Tag {
  id: number;
  name: string;
}

interface Props {
  selectedNames: string[];
  onChange: (tagNames: string[]) => void;
  placeholder?: string;
}

function normalizeTagName(tagName: string) {
  return tagName.trim().replace(/^#+/, "").replace(/\s+/g, " ").trim();
}

function normalizeTagKey(tagName: string) {
  return normalizeTagName(tagName).toLocaleLowerCase();
}

/**
 * Tags as removable pills with a "+ Tag" pill at the end. Tapping it opens
 * a small inline field, with matching tags offered underneath.
 */
export const AutocompleteTagSelector = ({
  selectedNames,
  onChange,
  placeholder = "Tag name",
}: Props) => {
  const [searchText, setSearchText] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const inputRef = useRef<TextInputInstance>(null);

  const { data: allTags = [] } = useUserTags();
  const normalizedSearchText = normalizeTagName(searchText);
  const normalizedSearchKey = normalizeTagKey(searchText);
  const selectedKeys = useMemo(
    () => new Set(selectedNames.map((tagName) => normalizeTagKey(tagName))),
    [selectedNames],
  );
  const searchMatchesExistingTag = allTags.some(
    (tag) => normalizeTagKey(tag.name) === normalizedSearchKey,
  );

  const suggestions = useMemo(() => {
    if (!normalizedSearchText) return [];
    const searchLower = normalizedSearchText.toLocaleLowerCase();
    return allTags
      .filter(
        (tag) =>
          tag.name.toLocaleLowerCase().includes(searchLower) &&
          !selectedKeys.has(normalizeTagKey(tag.name)),
      )
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 8);
  }, [normalizedSearchText, allTags, selectedKeys]);

  const canAddSearchText =
    normalizedSearchText.length > 0 &&
    !selectedKeys.has(normalizedSearchKey) &&
    !searchMatchesExistingTag;

  const addTagName = (tagName: string) => {
    const normalizedTagName = normalizeTagName(tagName);
    if (!normalizedTagName) return;

    onChange([
      ...selectedNames.filter(
        (selectedName) =>
          normalizeTagKey(selectedName) !== normalizeTagKey(normalizedTagName),
      ),
      normalizedTagName,
    ]);
    setSearchText("");
    inputRef.current?.focus();
  };

  const handleSubmit = () => {
    const exactMatch = allTags.find(
      (tag: Tag) => normalizeTagKey(tag.name) === normalizedSearchKey,
    );
    if (exactMatch) {
      addTagName(exactMatch.name);
    } else if (normalizedSearchText) {
      addTagName(normalizedSearchText);
    }
  };

  const handleRemoveTag = (tagName: string) => {
    onChange(
      selectedNames.filter(
        (selectedName) =>
          normalizeTagKey(selectedName) !== normalizeTagKey(tagName),
      ),
    );
  };

  const handleBlur = () => {
    // Let a tap on a suggestion land before the field closes.
    setTimeout(() => {
      if (inputRef.current?.isFocused()) return;
      setIsAdding(false);
      setSearchText("");
    }, 150);
  };

  const showSuggestions =
    isAdding && (suggestions.length > 0 || canAddSearchText);

  return (
    <View style={styles.container}>
      <View style={styles.pills}>
        {selectedNames.map((tagName) => (
          <Pressable
            key={normalizeTagKey(tagName)}
            onPress={() => handleRemoveTag(tagName)}
            accessibilityRole="button"
            accessibilityLabel={`Remove tag ${tagName}`}
            hitSlop={4}
            style={({ pressed }) => [styles.tag, pressed && styles.pressed]}
          >
            <Text style={styles.tagText}>{tagName}</Text>
            <Ionicons name="close" size={13} style={styles.tagRemoveIcon} />
          </Pressable>
        ))}

        {isAdding ? (
          <View style={styles.inputPill}>
            <TextInput
              ref={inputRef}
              autoFocus
              value={searchText}
              onChangeText={setSearchText}
              onSubmitEditing={handleSubmit}
              onBlur={handleBlur}
              submitBehavior="submit"
              returnKeyType="done"
              placeholder={placeholder}
              placeholderTextColor={styles.placeholder.color}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="New tag"
              style={styles.input}
            />
          </View>
        ) : (
          <Pressable
            onPress={() => setIsAdding(true)}
            accessibilityRole="button"
            accessibilityLabel="Add tag"
            hitSlop={4}
            style={({ pressed }) => [styles.addPill, pressed && styles.pressed]}
          >
            <Ionicons name="add" size={14} style={styles.addPillText} />
            <Text style={styles.addPillText}>Tag</Text>
          </Pressable>
        )}
      </View>

      {showSuggestions ? (
        <View style={styles.suggestions}>
          {suggestions.map((tag) => (
            <Pressable
              key={tag.id}
              onPress={() => addTagName(tag.name)}
              accessibilityRole="button"
              accessibilityLabel={`Add tag ${tag.name}`}
              style={({ pressed }) => [
                styles.suggestion,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="add" size={13} style={styles.suggestionIcon} />
              <Text style={styles.suggestionText}>{tag.name}</Text>
            </Pressable>
          ))}
          {canAddSearchText ? (
            <Pressable
              onPress={() => addTagName(searchText)}
              accessibilityRole="button"
              accessibilityLabel={`Create tag ${normalizedSearchText}`}
              style={({ pressed }) => [
                styles.suggestion,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="add" size={13} style={styles.suggestionIcon} />
              <Text style={styles.suggestionText}>
                Create “{normalizedSearchText}”
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create((theme) => ({
  container: {
    width: "100%",
    gap: 8,
  },
  pills: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
  },
  tag: {
    height: 30,
    paddingLeft: 11,
    paddingRight: 8,
    borderRadius: 15,
    backgroundColor: theme.colors.inputBackground,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  tagText: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    fontFamily: theme.fonts.bold,
  },
  tagRemoveIcon: {
    color: theme.colors.textSecondary,
  },
  addPill: {
    height: 30,
    paddingHorizontal: 11,
    borderRadius: 15,
    backgroundColor: theme.colors.primarySoft,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  addPillText: {
    fontSize: 13,
    color: theme.colors.onPrimarySoft,
    fontFamily: theme.fonts.bold,
  },
  inputPill: {
    height: 30,
    minWidth: 120,
    paddingHorizontal: 11,
    borderRadius: 15,
    backgroundColor: theme.colors.inputBackground,
    borderWidth: 1.5,
    borderColor: theme.colors.primary,
    justifyContent: "center",
  },
  input: {
    minWidth: 96,
    paddingVertical: 0,
    fontSize: 13,
    fontFamily: theme.fonts.bold,
    color: theme.colors.text,
  },
  placeholder: {
    color: theme.colors.placeholderText,
  },
  suggestions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  suggestion: {
    height: 30,
    paddingLeft: 8,
    paddingRight: 11,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.background,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  suggestionIcon: {
    color: theme.colors.textSecondary,
  },
  suggestionText: {
    fontSize: 13,
    color: theme.colors.text,
    fontFamily: theme.fonts.medium,
  },
  pressed: {
    opacity: 0.6,
  },
}));
