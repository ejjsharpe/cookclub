import { TrueSheet } from "@lodev09/react-native-true-sheet";
import { forwardRef, useState, useImperativeHandle, useRef } from "react";
import {
  View,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { StyleSheet, UnistylesRuntime } from "react-native-unistyles";

import {
  useGetUserShoppingLists,
  useCreateShoppingList,
  useDeleteShoppingList,
  type ShoppingListWithMeta,
} from "../../api/shopping";
import { AppSheet } from "../AppSheet";
import { Text } from "../Text";

import { Ionicons } from "@/components/Ionicons";

const LIST_PREVIEW_SIZE = 58;

interface ListItemProps {
  list: ShoppingListWithMeta;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  showDelete: boolean;
}

const ListItem = ({
  list,
  isActive,
  onSelect,
  onDelete,
  showDelete,
}: ListItemProps) => {
  const metadata = list.isDefault
    ? "Default list"
    : list.isOwner
      ? "Personal list"
      : `Shared by ${list.owner.name}`;

  return (
    <TouchableOpacity
      style={styles.listRow}
      onPress={onSelect}
      activeOpacity={0.78}
    >
      <View style={styles.listInfo}>
        <View style={styles.listPreview}>
          <Ionicons name="cart-outline" size={28} style={styles.previewIcon} />
        </View>
        <View style={styles.listTextWrap}>
          <Text type="headline" numberOfLines={1}>
            {list.name}
          </Text>
          <Text type="caption" style={styles.listMeta} numberOfLines={1}>
            {metadata}
          </Text>
        </View>
      </View>
      <View style={styles.listActions}>
        {showDelete && !list.isDefault && list.isOwner && (
          <TouchableOpacity
            onPress={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            style={styles.deleteButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons
              name="trash-outline"
              size={18}
              style={styles.deleteIcon}
            />
          </TouchableOpacity>
        )}
        {isActive ? (
          <Ionicons
            name="checkmark-circle"
            size={24}
            style={styles.checkIcon}
          />
        ) : (
          <View style={styles.radio} />
        )}
      </View>
    </TouchableOpacity>
  );
};

export interface ShoppingListPickerSheetProps {
  activeListId?: number;
  onSelectList?: (listId: number, listName?: string) => void;
}

export interface ShoppingListPickerSheetRef {
  present: () => void;
  dismiss: () => void;
}

export const ShoppingListPickerSheet = forwardRef<
  ShoppingListPickerSheetRef,
  ShoppingListPickerSheetProps
>(({ activeListId, onSelectList }, ref) => {
  const theme = UnistylesRuntime.getTheme();
  const sheetRef = useRef<TrueSheet>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [listToDelete, setListToDelete] = useState<number | null>(null);

  const { data: shoppingLists, isLoading } = useGetUserShoppingLists();
  const createMutation = useCreateShoppingList();
  const deleteMutation = useDeleteShoppingList();

  useImperativeHandle(ref, () => ({
    present: () => sheetRef.current?.present(),
    dismiss: () => sheetRef.current?.dismiss(),
  }));

  const handleSelectList = (list: ShoppingListWithMeta) => {
    onSelectList?.(list.id, list.name);
    sheetRef.current?.dismiss();
  };

  const handleCreateList = async () => {
    if (!newListName.trim()) return;

    try {
      const newList = await createMutation.mutateAsync({
        name: newListName.trim(),
      });
      if (newList) {
        onSelectList?.(newList.id, newList.name);
      }
      setNewListName("");
      setIsCreating(false);
      sheetRef.current?.dismiss();
    } catch {
      // Error handled by mutation
    }
  };

  const handleDeleteList = async (listId: number) => {
    setListToDelete(listId);
    try {
      await deleteMutation.mutateAsync({ shoppingListId: listId });
      // If we deleted the active list, switch to the default
      if (listId === activeListId) {
        const defaultList = shoppingLists?.find((l) => l.isDefault);
        if (defaultList) {
          onSelectList?.(defaultList.id, defaultList.name);
        }
      }
    } catch {
      // Error handled by mutation
    } finally {
      setListToDelete(null);
    }
  };

  const ownedLists = shoppingLists?.filter((l) => l.isOwner) ?? [];
  const sharedLists = shoppingLists?.filter((l) => !l.isOwner) ?? [];

  return (
    <AppSheet
      ref={sheetRef}
      title="Select Shopping List"
      detents={[0.62, 1]}
      scrollable
      backgroundColor={theme.colors.background}
    >
      <ScrollView style={styles.scrollView}>
        <View style={styles.scrollContent}>
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" />
            </View>
          ) : (
            <>
              {ownedLists.length > 0 && (
                <View style={styles.section}>
                  <Text type="caption" style={styles.sectionTitle}>
                    Your Lists
                  </Text>
                  <View style={styles.listGroup}>
                    {ownedLists.map((list) => (
                      <ListItem
                        key={list.id}
                        list={list}
                        isActive={list.id === activeListId}
                        onSelect={() => handleSelectList(list)}
                        onDelete={() => handleDeleteList(list.id)}
                        showDelete={listToDelete !== list.id}
                      />
                    ))}
                  </View>
                </View>
              )}

              {sharedLists.length > 0 && (
                <View style={styles.section}>
                  <Text type="caption" style={styles.sectionTitle}>
                    Shared With You
                  </Text>
                  <View style={styles.listGroup}>
                    {sharedLists.map((list) => (
                      <ListItem
                        key={list.id}
                        list={list}
                        isActive={list.id === activeListId}
                        onSelect={() => handleSelectList(list)}
                        onDelete={() => {}}
                        showDelete={false}
                      />
                    ))}
                  </View>
                </View>
              )}

              {isCreating ? (
                <View style={styles.createPanel}>
                  <Text type="heading">New list name</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. Weekend BBQ"
                    placeholderTextColor={theme.colors.placeholderText}
                    value={newListName}
                    onChangeText={setNewListName}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={handleCreateList}
                  />
                  <View style={styles.createActions}>
                    <TouchableOpacity
                      style={styles.cancelButton}
                      onPress={() => {
                        setNewListName("");
                        setIsCreating(false);
                      }}
                      activeOpacity={0.78}
                    >
                      <Text type="body">Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.saveButton,
                        (!newListName.trim() || createMutation.isPending) &&
                          styles.saveButtonDisabled,
                      ]}
                      onPress={handleCreateList}
                      disabled={!newListName.trim() || createMutation.isPending}
                      activeOpacity={0.78}
                    >
                      {createMutation.isPending ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text type="highlight" style={styles.saveButtonText}>
                          Create
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.listRow, styles.newListButton]}
                  onPress={() => setIsCreating(true)}
                  activeOpacity={0.78}
                >
                  <View style={styles.listInfo}>
                    <View style={styles.newListPreview}>
                      <Ionicons
                        name="add"
                        size={28}
                        style={styles.newListPreviewIcon}
                      />
                    </View>
                    <View style={styles.listTextWrap}>
                      <Text type="headline" numberOfLines={1}>
                        New List
                      </Text>
                      <Text type="caption" style={styles.listMeta}>
                        Create shopping list
                      </Text>
                    </View>
                  </View>
                  <Ionicons
                    name="add-circle-outline"
                    size={24}
                    style={styles.newListIcon}
                  />
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      </ScrollView>
    </AppSheet>
  );
});

const styles = StyleSheet.create((theme) => ({
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 24,
    gap: 18,
  },
  loadingContainer: {
    alignItems: "center",
    paddingVertical: 32,
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    color: theme.colors.textSecondary,
  },
  listGroup: {
    gap: 12,
  },
  listRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
    gap: 14,
  },
  listInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: 12,
  },
  listPreview: {
    width: LIST_PREVIEW_SIZE,
    height: LIST_PREVIEW_SIZE,
    borderRadius: LIST_PREVIEW_SIZE * 0.12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.inputBackground,
  },
  previewIcon: {
    color: theme.colors.textSecondary,
  },
  listTextWrap: {
    flex: 1,
    gap: 3,
  },
  listMeta: {
    color: theme.colors.textSecondary,
  },
  listActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  deleteButton: {
    padding: 4,
  },
  deleteIcon: {
    color: theme.colors.destructive,
  },
  checkIcon: {
    color: theme.colors.primary,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.background,
  },
  createPanel: {
    gap: 12,
    padding: 14,
    borderRadius: theme.borderRadius.medium,
    backgroundColor: theme.colors.inputBackground,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.medium,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    lineHeight: 21,
    includeFontPadding: false,
    textAlignVertical: "center",
    color: theme.colors.text,
    backgroundColor: theme.colors.background,
  },
  createActions: {
    flexDirection: "row",
    gap: 10,
  },
  cancelButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.background,
  },
  saveButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.primary,
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    color: theme.colors.buttonText,
  },
  newListButton: {
    opacity: 0.9,
  },
  newListPreview: {
    width: LIST_PREVIEW_SIZE,
    height: LIST_PREVIEW_SIZE,
    borderRadius: LIST_PREVIEW_SIZE * 0.12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.inputBackground,
  },
  newListPreviewIcon: {
    color: theme.colors.textSecondary,
  },
  newListIcon: {
    color: theme.colors.textSecondary,
  },
}));
