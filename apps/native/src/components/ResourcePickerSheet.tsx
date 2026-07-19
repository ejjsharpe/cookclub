import { TrueSheet } from "@lodev09/react-native-true-sheet";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { StyleSheet, UnistylesRuntime } from "react-native-unistyles";

import { AppSheet } from "./AppSheet";
import { Ionicons } from "./Ionicons";
import { Text } from "./Text";

const PREVIEW_SIZE = 58;

interface PickerResource {
  id: number;
  name: string;
  isDefault: boolean;
  isOwner: boolean;
  owner: { name: string };
}

export interface ResourcePickerSheetRef {
  present: () => void;
  dismiss: () => void;
}

interface ResourcePickerSheetProps {
  title: string;
  singularLabel: string;
  ownedSectionTitle: string;
  createTitle: string;
  createSubtitle: string;
  createPlaceholder: string;
  icon: "calendar-outline" | "cart-outline";
  activeId?: number;
  resources?: PickerResource[];
  isLoading: boolean;
  isCreating: boolean;
  onSelect?: (id: number) => void;
  onCreate: (name: string) => Promise<{ id: number } | undefined>;
  onDelete: (id: number) => Promise<unknown>;
}

interface ResourceItemProps {
  resource: PickerResource;
  singularLabel: string;
  icon: ResourcePickerSheetProps["icon"];
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  showDelete: boolean;
}

const ResourceItem = ({
  resource,
  singularLabel,
  icon,
  isActive,
  onSelect,
  onDelete,
  showDelete,
}: ResourceItemProps) => {
  const metadata = resource.isDefault
    ? `Default ${singularLabel}`
    : resource.isOwner
      ? `Personal ${singularLabel}`
      : `Shared by ${resource.owner.name}`;

  return (
    <Pressable style={styles.resourceRow} onPress={onSelect}>
      <View style={styles.resourceInfo}>
        <View style={styles.resourcePreview}>
          <Ionicons name={icon} size={28} style={styles.previewIcon} />
        </View>
        <View style={styles.resourceTextWrap}>
          <Text type="headline" numberOfLines={1}>
            {resource.name}
          </Text>
          <Text type="caption" style={styles.resourceMeta} numberOfLines={1}>
            {metadata}
          </Text>
        </View>
      </View>
      <View style={styles.resourceActions}>
        {showDelete && !resource.isDefault && resource.isOwner ? (
          <Pressable
            onPress={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            style={styles.deleteButton}
            hitSlop={10}
          >
            <Ionicons
              name="trash-outline"
              size={18}
              style={styles.deleteIcon}
            />
          </Pressable>
        ) : null}
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
    </Pressable>
  );
};

export const ResourcePickerSheet = forwardRef<
  ResourcePickerSheetRef,
  ResourcePickerSheetProps
>(
  (
    {
      title,
      singularLabel,
      ownedSectionTitle,
      createTitle,
      createSubtitle,
      createPlaceholder,
      icon,
      activeId,
      resources,
      isLoading,
      isCreating: createIsPending,
      onSelect,
      onCreate,
      onDelete,
    },
    ref,
  ) => {
    const theme = UnistylesRuntime.getTheme();
    const sheetRef = useRef<TrueSheet>(null);
    const inputRef = useRef<TextInput>(null);
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [newName, setNewName] = useState("");
    const [resourceToDelete, setResourceToDelete] = useState<number | null>(
      null,
    );

    useImperativeHandle(ref, () => ({
      present: () => sheetRef.current?.present(),
      dismiss: () => sheetRef.current?.dismiss(),
    }));

    useEffect(() => {
      if (!showCreateForm) return;
      const timeout = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(timeout);
    }, [showCreateForm]);

    const selectResource = (id: number) => {
      onSelect?.(id);
      sheetRef.current?.dismiss();
    };

    const createResource = async () => {
      const name = newName.trim();
      if (!name) return;

      try {
        const created = await onCreate(name);
        if (created) onSelect?.(created.id);
        setNewName("");
        setShowCreateForm(false);
        sheetRef.current?.dismiss();
      } catch {
        // Mutation hooks own user-facing error handling.
      }
    };

    const deleteResource = async (id: number) => {
      setResourceToDelete(id);
      try {
        await onDelete(id);
        if (id === activeId) {
          const defaultResource = resources?.find((item) => item.isDefault);
          if (defaultResource) onSelect?.(defaultResource.id);
        }
      } catch {
        // Mutation hooks own user-facing error handling.
      } finally {
        setResourceToDelete(null);
      }
    };

    const ownedResources = resources?.filter((item) => item.isOwner) ?? [];
    const sharedResources = resources?.filter((item) => !item.isOwner) ?? [];
    const createDisabled = !newName.trim() || createIsPending;

    return (
      <AppSheet
        ref={sheetRef}
        title={title}
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
                {ownedResources.length > 0 ? (
                  <View style={styles.section}>
                    <Text type="caption" style={styles.sectionTitle}>
                      {ownedSectionTitle}
                    </Text>
                    <View style={styles.resourceGroup}>
                      {ownedResources.map((resource) => (
                        <ResourceItem
                          key={resource.id}
                          resource={resource}
                          singularLabel={singularLabel}
                          icon={icon}
                          isActive={resource.id === activeId}
                          onSelect={() => selectResource(resource.id)}
                          onDelete={() => {
                            deleteResource(resource.id);
                          }}
                          showDelete={resourceToDelete !== resource.id}
                        />
                      ))}
                    </View>
                  </View>
                ) : null}

                {sharedResources.length > 0 ? (
                  <View style={styles.section}>
                    <Text type="caption" style={styles.sectionTitle}>
                      Shared With You
                    </Text>
                    <View style={styles.resourceGroup}>
                      {sharedResources.map((resource) => (
                        <ResourceItem
                          key={resource.id}
                          resource={resource}
                          singularLabel={singularLabel}
                          icon={icon}
                          isActive={resource.id === activeId}
                          onSelect={() => selectResource(resource.id)}
                          onDelete={() => {}}
                          showDelete={false}
                        />
                      ))}
                    </View>
                  </View>
                ) : null}

                {showCreateForm ? (
                  <View style={styles.createPanel}>
                    <Text type="heading">{createTitle}</Text>
                    <TextInput
                      ref={inputRef}
                      style={styles.input}
                      placeholder={createPlaceholder}
                      placeholderTextColor={theme.colors.placeholderText}
                      value={newName}
                      onChangeText={setNewName}
                      returnKeyType="done"
                      onSubmitEditing={() => {
                        createResource();
                      }}
                    />
                    <View style={styles.createActions}>
                      <Pressable
                        style={styles.cancelButton}
                        onPress={() => {
                          setNewName("");
                          setShowCreateForm(false);
                        }}
                      >
                        <Text type="body">Cancel</Text>
                      </Pressable>
                      <Pressable
                        style={[
                          styles.saveButton,
                          createDisabled && styles.saveButtonDisabled,
                        ]}
                        onPress={() => {
                          createResource();
                        }}
                        disabled={createDisabled}
                      >
                        {createIsPending ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Text type="highlight" style={styles.saveButtonText}>
                            Create
                          </Text>
                        )}
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <Pressable
                    style={[styles.resourceRow, styles.newResourceButton]}
                    onPress={() => setShowCreateForm(true)}
                  >
                    <View style={styles.resourceInfo}>
                      <View style={styles.newResourcePreview}>
                        <Ionicons
                          name="add"
                          size={28}
                          style={styles.newResourcePreviewIcon}
                        />
                      </View>
                      <View style={styles.resourceTextWrap}>
                        <Text type="headline" numberOfLines={1}>
                          {createTitle.replace(" name", "")}
                        </Text>
                        <Text type="caption" style={styles.resourceMeta}>
                          {createSubtitle}
                        </Text>
                      </View>
                    </View>
                    <Ionicons
                      name="add-circle-outline"
                      size={24}
                      style={styles.newResourceIcon}
                    />
                  </Pressable>
                )}
              </>
            )}
          </View>
        </ScrollView>
      </AppSheet>
    );
  },
);

const styles = StyleSheet.create((theme) => ({
  scrollView: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 24,
    gap: 18,
  },
  loadingContainer: { alignItems: "center", paddingVertical: 32 },
  section: { gap: 10 },
  sectionTitle: { color: theme.colors.textSecondary },
  resourceGroup: { gap: 12 },
  resourceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
    gap: 14,
  },
  resourceInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: 12,
  },
  resourcePreview: {
    width: PREVIEW_SIZE,
    height: PREVIEW_SIZE,
    borderRadius: PREVIEW_SIZE * 0.12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.inputBackground,
  },
  previewIcon: { color: theme.colors.textSecondary },
  resourceTextWrap: { flex: 1, gap: 3 },
  resourceMeta: { color: theme.colors.textSecondary },
  resourceActions: { flexDirection: "row", alignItems: "center", gap: 12 },
  deleteButton: { padding: 4 },
  deleteIcon: { color: theme.colors.destructive },
  checkIcon: { color: theme.colors.primary },
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
  createActions: { flexDirection: "row", gap: 10 },
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
  saveButtonDisabled: { opacity: 0.5 },
  saveButtonText: { color: theme.colors.buttonText },
  newResourceButton: { opacity: 0.9 },
  newResourcePreview: {
    width: PREVIEW_SIZE,
    height: PREVIEW_SIZE,
    borderRadius: PREVIEW_SIZE * 0.12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.inputBackground,
  },
  newResourcePreviewIcon: { color: theme.colors.textSecondary },
  newResourceIcon: { color: theme.colors.textSecondary },
}));
