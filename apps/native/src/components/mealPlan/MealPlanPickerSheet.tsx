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
  useGetMealPlans,
  useCreateMealPlan,
  useDeleteMealPlan,
  type MealPlan,
} from "../../api/mealPlan";
import { AppSheet } from "../AppSheet";
import { Text } from "../Text";

import { Ionicons } from "@/components/Ionicons";

const PLAN_PREVIEW_SIZE = 58;

interface PlanItemProps {
  plan: MealPlan;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  showDelete: boolean;
}

const PlanItem = ({
  plan,
  isActive,
  onSelect,
  onDelete,
  showDelete,
}: PlanItemProps) => {
  const metadata = plan.isDefault
    ? "Default plan"
    : plan.isOwner
      ? "Personal plan"
      : `Shared by ${plan.owner.name}`;

  return (
    <TouchableOpacity
      style={styles.planRow}
      onPress={onSelect}
      activeOpacity={0.78}
    >
      <View style={styles.planInfo}>
        <View style={styles.planPreview}>
          <Ionicons
            name="calendar-outline"
            size={28}
            style={styles.previewIcon}
          />
        </View>
        <View style={styles.planTextWrap}>
          <Text type="headline" numberOfLines={1}>
            {plan.name}
          </Text>
          <Text type="caption" style={styles.planMeta} numberOfLines={1}>
            {metadata}
          </Text>
        </View>
      </View>
      <View style={styles.planActions}>
        {showDelete && !plan.isDefault && plan.isOwner && (
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

export interface MealPlanPickerSheetProps {
  activePlanId?: number;
  onSelectPlan?: (planId: number) => void;
}

export interface MealPlanPickerSheetRef {
  present: () => void;
  dismiss: () => void;
}

export const MealPlanPickerSheet = forwardRef<
  MealPlanPickerSheetRef,
  MealPlanPickerSheetProps
>(({ activePlanId, onSelectPlan }, ref) => {
  const theme = UnistylesRuntime.getTheme();
  const sheetRef = useRef<TrueSheet>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newPlanName, setNewPlanName] = useState("");
  const [planToDelete, setPlanToDelete] = useState<number | null>(null);

  const { data: mealPlans, isLoading } = useGetMealPlans();
  const createMutation = useCreateMealPlan();
  const deleteMutation = useDeleteMealPlan();

  useImperativeHandle(ref, () => ({
    present: () => sheetRef.current?.present(),
    dismiss: () => sheetRef.current?.dismiss(),
  }));

  const handleSelectPlan = (planId: number) => {
    onSelectPlan?.(planId);
    sheetRef.current?.dismiss();
  };

  const handleCreatePlan = async () => {
    if (!newPlanName.trim()) return;

    try {
      const newPlan = await createMutation.mutateAsync({
        name: newPlanName.trim(),
      });
      if (newPlan) {
        onSelectPlan?.(newPlan.id);
      }
      setNewPlanName("");
      setIsCreating(false);
      sheetRef.current?.dismiss();
    } catch {
      // Error handled by mutation
    }
  };

  const handleDeletePlan = async (planId: number) => {
    setPlanToDelete(planId);
    try {
      await deleteMutation.mutateAsync({ mealPlanId: planId });
      // If we deleted the active plan, switch to the default
      if (planId === activePlanId) {
        const defaultPlan = mealPlans?.find((p) => p.isDefault);
        if (defaultPlan) {
          onSelectPlan?.(defaultPlan.id);
        }
      }
    } catch {
      // Error handled by mutation
    } finally {
      setPlanToDelete(null);
    }
  };

  const ownedPlans = mealPlans?.filter((p) => p.isOwner) ?? [];
  const sharedPlans = mealPlans?.filter((p) => !p.isOwner) ?? [];

  return (
    <AppSheet
      ref={sheetRef}
      title="Select Meal Plan"
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
              {ownedPlans.length > 0 && (
                <View style={styles.section}>
                  <Text type="caption" style={styles.sectionTitle}>
                    Your Plans
                  </Text>
                  <View style={styles.planGroup}>
                    {ownedPlans.map((plan) => (
                      <PlanItem
                        key={plan.id}
                        plan={plan}
                        isActive={plan.id === activePlanId}
                        onSelect={() => handleSelectPlan(plan.id)}
                        onDelete={() => handleDeletePlan(plan.id)}
                        showDelete={planToDelete !== plan.id}
                      />
                    ))}
                  </View>
                </View>
              )}

              {sharedPlans.length > 0 && (
                <View style={styles.section}>
                  <Text type="caption" style={styles.sectionTitle}>
                    Shared With You
                  </Text>
                  <View style={styles.planGroup}>
                    {sharedPlans.map((plan) => (
                      <PlanItem
                        key={plan.id}
                        plan={plan}
                        isActive={plan.id === activePlanId}
                        onSelect={() => handleSelectPlan(plan.id)}
                        onDelete={() => {}}
                        showDelete={false}
                      />
                    ))}
                  </View>
                </View>
              )}

              {isCreating ? (
                <View style={styles.createPanel}>
                  <Text type="heading">New plan name</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. Family Dinners"
                    placeholderTextColor={theme.colors.placeholderText}
                    value={newPlanName}
                    onChangeText={setNewPlanName}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={handleCreatePlan}
                  />
                  <View style={styles.createActions}>
                    <TouchableOpacity
                      style={styles.cancelButton}
                      onPress={() => {
                        setNewPlanName("");
                        setIsCreating(false);
                      }}
                      activeOpacity={0.78}
                    >
                      <Text type="body">Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.saveButton,
                        (!newPlanName.trim() || createMutation.isPending) &&
                          styles.saveButtonDisabled,
                      ]}
                      onPress={handleCreatePlan}
                      disabled={!newPlanName.trim() || createMutation.isPending}
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
                  style={[styles.planRow, styles.newPlanButton]}
                  onPress={() => setIsCreating(true)}
                  activeOpacity={0.78}
                >
                  <View style={styles.planInfo}>
                    <View style={styles.newPlanPreview}>
                      <Ionicons
                        name="add"
                        size={28}
                        style={styles.newPlanPreviewIcon}
                      />
                    </View>
                    <View style={styles.planTextWrap}>
                      <Text type="headline" numberOfLines={1}>
                        New Plan
                      </Text>
                      <Text type="caption" style={styles.planMeta}>
                        Create meal plan
                      </Text>
                    </View>
                  </View>
                  <Ionicons
                    name="add-circle-outline"
                    size={24}
                    style={styles.newPlanIcon}
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
  planGroup: {
    gap: 12,
  },
  planRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
    gap: 14,
  },
  planInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: 12,
  },
  planPreview: {
    width: PLAN_PREVIEW_SIZE,
    height: PLAN_PREVIEW_SIZE,
    borderRadius: PLAN_PREVIEW_SIZE * 0.12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.inputBackground,
  },
  previewIcon: {
    color: theme.colors.textSecondary,
  },
  planTextWrap: {
    flex: 1,
    gap: 3,
  },
  planMeta: {
    color: theme.colors.textSecondary,
  },
  planActions: {
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
  newPlanButton: {
    opacity: 0.9,
  },
  newPlanPreview: {
    width: PLAN_PREVIEW_SIZE,
    height: PLAN_PREVIEW_SIZE,
    borderRadius: PLAN_PREVIEW_SIZE * 0.12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.inputBackground,
  },
  newPlanPreviewIcon: {
    color: theme.colors.textSecondary,
  },
  newPlanIcon: {
    color: theme.colors.textSecondary,
  },
}));
