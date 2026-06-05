import { TrueSheet } from "@lodev09/react-native-true-sheet";
import {
  forwardRef,
  useState,
  useImperativeHandle,
  useRef,
  useMemo,
} from "react";
import {
  View,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ScrollView,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, UnistylesRuntime } from "react-native-unistyles";

import { AppSheet } from "./AppSheet";
import { ImageGrid } from "./CollectionGridCard";
import { Text } from "./Text";
import {
  useGetUserCollections,
  useCreateCollection,
  useUpdateRecipeCollections,
} from "../api/collection";
import { useDeleteRecipe } from "../api/recipe";

import { Ionicons } from "@/components/Ionicons";

const COLLECTION_PREVIEW_SIZE = 58;

export interface CollectionSelectorSheetProps {
  recipeId?: number;
}

export interface CollectionSelectorSheetRef {
  present: () => void;
  dismiss: () => void;
}

export const CollectionSelectorSheet = forwardRef<
  CollectionSelectorSheetRef,
  CollectionSelectorSheetProps
>(({ recipeId }, ref) => {
  const theme = UnistylesRuntime.getTheme();
  const insets = useSafeAreaInsets();
  const sheetRef = useRef<TrueSheet>(null);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [isCreatingCollection, setIsCreatingCollection] = useState(false);
  const [selectedIdsOverride, setSelectedIdsOverride] =
    useState<Set<number> | null>(null);

  const { data: collections, isLoading } = useGetUserCollections({
    recipeId,
    includeMetadata: true,
  });
  const updateCollectionsMutation = useUpdateRecipeCollections();
  const deleteRecipeMutation = useDeleteRecipe();
  const createCollectionMutation = useCreateCollection();

  // Get the original collection IDs from server data
  const originalIds = useMemo(() => {
    if (!collections) return new Set<number>();
    return new Set(
      collections
        .filter((c) => "hasRecipe" in c && c.hasRecipe)
        .map((c) => c.id),
    );
  }, [collections]);

  const selectedIds = selectedIdsOverride ?? originalIds;

  // Check if there are unsaved changes
  const hasChanges = useMemo(() => {
    if (selectedIds.size !== originalIds.size) return true;
    for (const id of selectedIds) {
      if (!originalIds.has(id)) return true;
    }
    return false;
  }, [selectedIds, originalIds]);

  const isSaving =
    updateCollectionsMutation.isPending || deleteRecipeMutation.isPending;
  const selectedCount = selectedIds.size;

  useImperativeHandle(ref, () => ({
    present: () => sheetRef.current?.present(),
    dismiss: () => sheetRef.current?.dismiss(),
  }));

  const handleSheetDismiss = () => {
    setNewCollectionName("");
    setIsCreatingCollection(false);
    setSelectedIdsOverride(null);
  };

  const handleToggleCollection = (collectionId: number) => {
    setSelectedIdsOverride((prev) => {
      const next = new Set(prev ?? originalIds);
      if (next.has(collectionId)) {
        next.delete(collectionId);
      } else {
        next.add(collectionId);
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (!recipeId) return;

    if (selectedIds.size === 0) {
      // Show warning dialog about deleting the recipe
      Alert.alert(
        "Delete Recipe?",
        "Removing this recipe from all collections will delete it. This cannot be undone.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              await deleteRecipeMutation.mutateAsync({ recipeId });
              sheetRef.current?.dismiss();
            },
          },
        ],
      );
      return;
    }

    // Save collection changes
    await updateCollectionsMutation.mutateAsync({
      recipeId,
      collectionIds: Array.from(selectedIds),
    });
    sheetRef.current?.dismiss();
  };

  const handleCreateCollection = async () => {
    if (!newCollectionName.trim()) return;

    try {
      const newCollection = await createCollectionMutation.mutateAsync({
        name: newCollectionName.trim(),
      });

      if (newCollection) {
        // Add the new collection to selected IDs
        setSelectedIdsOverride(
          (prev) => new Set([...(prev ?? originalIds), newCollection.id]),
        );
      }

      setNewCollectionName("");
      setIsCreatingCollection(false);
    } catch {
      // Error handling is done in the mutation
    }
  };

  const hasCollections = collections && collections.length > 0;
  const isSaveDisabled = !hasChanges || isSaving;

  const renderFooter = () => (
    <View style={[styles.footer, { paddingBottom: insets.bottom }]}>
      <TouchableOpacity
        style={[
          styles.saveButton,
          selectedCount === 0 && hasChanges && styles.deleteSaveButton,
          isSaveDisabled && styles.saveButtonDisabled,
        ]}
        onPress={handleSave}
        disabled={isSaveDisabled}
        activeOpacity={0.78}
      >
        {isSaving ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <>
            <Ionicons
              name={
                selectedCount === 0 && hasChanges
                  ? "trash-outline"
                  : "save-outline"
              }
              size={20}
              style={styles.saveButtonIcon}
            />
            <Text style={styles.saveButtonText}>
              {selectedCount === 0 && hasChanges
                ? "Remove Recipe"
                : "Save Changes"}
            </Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );

  return (
    <AppSheet
      ref={sheetRef}
      title="Manage Collections"
      detents={[0.62, 1]}
      scrollable
      backgroundColor={theme.colors.background}
      footer={renderFooter()}
      onDidDismiss={handleSheetDismiss}
    >
      <ScrollView style={styles.scrollView}>
        <View style={styles.scrollContent}>
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" />
            </View>
          ) : (
            <>
              {hasCollections ? (
                <View style={styles.collectionList}>
                  {collections.map((collection) => {
                    const isSelected = selectedIds.has(collection.id);
                    const previewImages =
                      "previewImages" in collection
                        ? collection.previewImages
                        : [];
                    const recipeCount =
                      "recipeCount" in collection ? collection.recipeCount : 0;

                    return (
                      <TouchableOpacity
                        key={collection.id}
                        style={[
                          styles.collectionRow,
                          isSaving && styles.collectionRowDisabled,
                        ]}
                        onPress={() => handleToggleCollection(collection.id)}
                        disabled={isSaving}
                        activeOpacity={0.78}
                      >
                        <View style={styles.collectionInfo}>
                          <ImageGrid
                            images={previewImages}
                            width={COLLECTION_PREVIEW_SIZE}
                          />
                          <View style={styles.collectionTextWrap}>
                            <Text type="headline" numberOfLines={1}>
                              {collection.name}
                            </Text>
                            <Text type="caption" style={styles.collectionMeta}>
                              {recipeCount}{" "}
                              {recipeCount === 1 ? "recipe" : "recipes"}
                            </Text>
                          </View>
                        </View>
                        {isSelected ? (
                          <Ionicons
                            name="checkmark-circle"
                            size={24}
                            style={styles.selectedIcon}
                          />
                        ) : (
                          <View style={styles.radio} />
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : (
                <View style={styles.emptyState}>
                  <Text type="bodyFaded" style={styles.emptyText}>
                    Create a collection to keep this recipe saved.
                  </Text>
                </View>
              )}

              {isCreatingCollection ? (
                <View style={styles.createCollectionPanel}>
                  <Text type="heading">New collection name</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. Breakfast Ideas"
                    placeholderTextColor={theme.colors.placeholderText}
                    value={newCollectionName}
                    onChangeText={setNewCollectionName}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={handleCreateCollection}
                  />
                  <View style={styles.createActions}>
                    <TouchableOpacity
                      style={styles.cancelButton}
                      onPress={() => {
                        setNewCollectionName("");
                        setIsCreatingCollection(false);
                      }}
                      activeOpacity={0.78}
                    >
                      <Text type="body">Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.createButton,
                        (!newCollectionName.trim() ||
                          createCollectionMutation.isPending) &&
                          styles.createButtonDisabled,
                      ]}
                      onPress={handleCreateCollection}
                      disabled={
                        !newCollectionName.trim() ||
                        createCollectionMutation.isPending
                      }
                      activeOpacity={0.78}
                    >
                      {createCollectionMutation.isPending ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text type="highlight" style={styles.createButtonText}>
                          Create
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.collectionRow, styles.newCollectionButton]}
                  onPress={() => setIsCreatingCollection(true)}
                  activeOpacity={0.78}
                >
                  <View style={styles.collectionInfo}>
                    <View style={styles.newCollectionPreview}>
                      <Ionicons
                        name="add"
                        size={28}
                        style={styles.newCollectionPreviewIcon}
                      />
                    </View>
                    <View style={styles.collectionTextWrap}>
                      <Text type="headline" numberOfLines={1}>
                        New Collection
                      </Text>
                      <Text type="caption" style={styles.collectionMeta}>
                        Create collection
                      </Text>
                    </View>
                  </View>
                  <Ionicons
                    name="add-circle-outline"
                    size={24}
                    style={styles.newCollectionIcon}
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
    gap: 14,
  },
  loadingContainer: {
    alignItems: "center",
    paddingVertical: 32,
  },
  collectionList: {
    gap: 12,
  },
  collectionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
    gap: 14,
  },
  collectionRowDisabled: {
    opacity: 0.5,
  },
  collectionInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: 12,
  },
  collectionTextWrap: {
    flex: 1,
    gap: 3,
  },
  collectionMeta: {
    color: theme.colors.textSecondary,
  },
  selectedIcon: {
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
  emptyState: {
    padding: 18,
    borderRadius: theme.borderRadius.medium,
    backgroundColor: theme.colors.inputBackground,
  },
  emptyText: {
    textAlign: "center",
  },
  createCollectionPanel: {
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
  createButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.primary,
  },
  createButtonDisabled: {
    opacity: 0.5,
  },
  createButtonText: {
    color: theme.colors.buttonText,
  },
  newCollectionButton: {
    opacity: 0.9,
  },
  newCollectionPreview: {
    width: COLLECTION_PREVIEW_SIZE,
    height: COLLECTION_PREVIEW_SIZE,
    borderRadius: COLLECTION_PREVIEW_SIZE * 0.12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.inputBackground,
  },
  newCollectionPreviewIcon: {
    color: theme.colors.textSecondary,
  },
  newCollectionIcon: {
    color: theme.colors.textSecondary,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: theme.colors.background,
  },
  saveButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 50,
    backgroundColor: theme.colors.primary,
    borderRadius: 25,
  },
  deleteSaveButton: {
    backgroundColor: "#ff3b30",
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonIcon: {
    color: theme.colors.buttonText,
  },
  saveButtonText: {
    color: theme.colors.buttonText,
    fontSize: 17,
    fontFamily: theme.fonts.semiBold,
  },
}));
