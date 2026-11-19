import { useState, useMemo, useRef } from "react";
import {
  View,
  TextInput,
  TouchableOpacity,
  type TextInputInstance,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { VSpace } from "./Space";
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
  variant?: "default" | "like" | "dislike";
}

function normalizeTagName(tagName: string) {
  return tagName.trim().replace(/^#+/, "").replace(/\s+/g, " ").trim();
}

function normalizeTagKey(tagName: string) {
  return normalizeTagName(tagName).toLocaleLowerCase();
}

export const AutocompleteTagSelector = ({
  selectedNames,
  onChange,
  placeholder = "Search...",
  variant = "default",
}: Props) => {
  const [searchText, setSearchText] = useState("");
  const [isFocused, setIsFocused] = useState(false);
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

  const filteredTags = useMemo(() => {
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

    const nextSelectedNames = [
      ...selectedNames.filter(
        (selectedName) =>
          normalizeTagKey(selectedName) !== normalizeTagKey(normalizedTagName),
      ),
      normalizedTagName,
    ];
    onChange(nextSelectedNames);
    setSearchText("");
    inputRef.current?.focus();
  };

  const handleSelectTag = (tag: Tag) => {
    addTagName(tag.name);
  };

  const handleRemoveTag = (tagName: string) => {
    onChange(
      selectedNames.filter(
        (selectedName) =>
          normalizeTagKey(selectedName) !== normalizeTagKey(tagName),
      ),
    );
  };

  const showDropdown =
    isFocused && (filteredTags.length > 0 || canAddSearchText);

  // Variant-specific colors
  const chipStyle =
    variant === "like"
      ? styles.chipLike
      : variant === "dislike"
        ? styles.chipDislike
        : styles.chipDefault;

  const chipTextStyle =
    variant === "like"
      ? styles.chipTextLike
      : variant === "dislike"
        ? styles.chipTextDislike
        : styles.chipTextDefault;

  return (
    <View style={styles.container}>
      {/* Search Input */}
      <View style={styles.inputWrapper}>
        <Ionicons name="search" size={18} style={styles.searchIcon} />
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={searchText}
          onChangeText={setSearchText}
          placeholder={placeholder}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setTimeout(() => setIsFocused(false), 150)}
          autoCapitalize="none"
          autoCorrect={false}
          placeholderTextColor={styles.placeholder.color}
        />
        {searchText.length > 0 && (
          <TouchableOpacity
            onPress={() => setSearchText("")}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close-circle" size={18} style={styles.clearIcon} />
          </TouchableOpacity>
        )}
      </View>

      {/* Dropdown */}
      {showDropdown && (
        <View style={styles.dropdown}>
          {filteredTags.map((tag) => (
            <TouchableOpacity
              key={tag.id}
              style={styles.dropdownItem}
              onPress={() => handleSelectTag(tag)}
              activeOpacity={0.7}
            >
              <Text style={styles.dropdownText}>{tag.name}</Text>
              <Ionicons
                name="add-circle-outline"
                size={20}
                style={styles.dropdownIcon}
              />
            </TouchableOpacity>
          ))}
          {canAddSearchText && (
            <TouchableOpacity
              style={styles.dropdownItem}
              onPress={() => addTagName(searchText)}
              activeOpacity={0.7}
            >
              <Text style={styles.dropdownText}>
                Add "{normalizedSearchText}"
              </Text>
              <Ionicons
                name="add-circle-outline"
                size={20}
                style={styles.dropdownIcon}
              />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Selected Chips */}
      {selectedNames.length > 0 && (
        <>
          <VSpace size={12} />
          <View style={styles.chipsContainer}>
            {selectedNames.map((tagName) => (
              <TouchableOpacity
                key={normalizeTagKey(tagName)}
                style={[styles.chip, chipStyle]}
                onPress={() => handleRemoveTag(tagName)}
                activeOpacity={0.7}
              >
                <Text style={[styles.chipText, chipTextStyle]}>{tagName}</Text>
                <Ionicons
                  name="close"
                  size={12}
                  color="#fff"
                  style={[styles.chipIcon, chipTextStyle]}
                />
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create((theme) => ({
  container: {
    width: "100%",
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
    backgroundColor: theme.colors.inputBackground,
    borderRadius: theme.borderRadius.extraLarge,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  searchIcon: {
    marginRight: 8,
    color: theme.colors.textTertiary,
  },
  input: {
    flex: 1,
    fontSize: 16,
    lineHeight: 21,
    includeFontPadding: false,
    textAlignVertical: "center",
    fontFamily: theme.fonts.regular,
    color: theme.colors.text,
  },
  placeholder: {
    color: theme.colors.placeholderText,
  },
  clearIcon: {
    color: theme.colors.textTertiary,
  },
  dropdown: {
    marginTop: 4,
    backgroundColor: theme.colors.background,
    borderRadius: theme.borderRadius.medium,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
  dropdownItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  dropdownText: {
    flex: 1,
    fontSize: 16,
    fontFamily: theme.fonts.regular,
    color: theme.colors.text,
  },
  dropdownIcon: {
    color: theme.colors.textTertiary,
  },
  chipsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: theme.borderRadius.full,
  },
  chipDefault: {
    backgroundColor: theme.colors.primary,
  },
  chipLike: {
    backgroundColor: "#22c55e",
  },
  chipDislike: {
    backgroundColor: "#ef4444",
  },
  chipText: {
    fontSize: 12,
    lineHeight: 14,
    fontFamily: theme.fonts.medium,
    includeFontPadding: false,
  },
  chipTextDefault: {
    color: "#fff",
  },
  chipTextLike: {
    color: "#fff",
  },
  chipTextDislike: {
    color: "#fff",
  },
  chipIcon: {
    marginLeft: 4,
    lineHeight: 14,
  },
}));
