import { forwardRef } from "react";

import {
  useCreateMealPlan,
  useDeleteMealPlan,
  useGetMealPlans,
} from "../../api/mealPlan";
import {
  ResourcePickerSheet,
  type ResourcePickerSheetRef,
} from "../ResourcePickerSheet";

export interface MealPlanPickerSheetProps {
  activePlanId?: number;
  onSelectPlan?: (planId: number) => void;
}

export type MealPlanPickerSheetRef = ResourcePickerSheetRef;

export const MealPlanPickerSheet = forwardRef<
  MealPlanPickerSheetRef,
  MealPlanPickerSheetProps
>(({ activePlanId, onSelectPlan }, ref) => {
  const { data: mealPlans, isLoading } = useGetMealPlans();
  const create = useCreateMealPlan();
  const remove = useDeleteMealPlan();

  return (
    <ResourcePickerSheet
      ref={ref}
      title="Select Meal Plan"
      singularLabel="plan"
      ownedSectionTitle="Your Plans"
      createTitle="New plan name"
      createSubtitle="Create meal plan"
      createPlaceholder="e.g. Family Dinners"
      icon="calendar-outline"
      activeId={activePlanId}
      resources={mealPlans}
      isLoading={isLoading}
      isCreating={create.isPending}
      onSelect={onSelectPlan}
      onCreate={(name) => create.mutateAsync({ name })}
      onDelete={(mealPlanId) => remove.mutateAsync({ mealPlanId })}
    />
  );
});
