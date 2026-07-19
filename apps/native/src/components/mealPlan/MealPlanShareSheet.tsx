import { forwardRef } from "react";

import {
  useCancelMealPlanInvitation,
  useGetMealPlanInvitationStatus,
  useGetShareableUsers,
  useGetShareStatus,
  useInviteToMealPlan,
  useRemoveMealPlanMember,
} from "../../api/mealPlan";
import {
  ShareResourceSheet,
  type ShareResourceSheetRef,
} from "../ShareResourceSheet";

export interface MealPlanShareSheetProps {
  mealPlanId?: number;
  planName?: string;
}

export type MealPlanShareSheetRef = ShareResourceSheetRef;

export const MealPlanShareSheet = forwardRef<
  MealPlanShareSheetRef,
  MealPlanShareSheetProps
>(({ mealPlanId, planName }, ref) => {
  const { data: friends, isLoading: isLoadingUsers } = useGetShareableUsers();
  const { data: shareStatus, isLoading: isLoadingStatus } = useGetShareStatus({
    mealPlanId: mealPlanId ?? 0,
    enabled: Boolean(mealPlanId),
  });
  const { data: invitationStatus, isLoading: isLoadingInvitations } =
    useGetMealPlanInvitationStatus({
      mealPlanId: mealPlanId ?? 0,
      enabled: Boolean(mealPlanId),
    });
  const invite = useInviteToMealPlan();
  const cancelInvitation = useCancelMealPlanInvitation();
  const removeMember = useRemoveMealPlanMember();

  return (
    <ShareResourceSheet
      ref={ref}
      title="Share Meal Plan"
      subtitle={planName}
      resourceLabel="meal plan"
      resourcePlural="meal plans"
      friends={friends}
      sharedUserIds={shareStatus?.map(({ userId }) => userId)}
      invitedUserIds={invitationStatus?.map(({ userId }) => userId)}
      isLoading={isLoadingUsers || isLoadingStatus || isLoadingInvitations}
      onInvite={(userId) =>
        mealPlanId
          ? invite.mutateAsync({ mealPlanId, userId })
          : Promise.resolve()
      }
      onCancelInvitation={(userId) =>
        mealPlanId
          ? cancelInvitation.mutateAsync({ mealPlanId, userId })
          : Promise.resolve()
      }
      onRemoveMember={(userId) =>
        mealPlanId
          ? removeMember.mutateAsync({ mealPlanId, userId })
          : Promise.resolve()
      }
    />
  );
});
