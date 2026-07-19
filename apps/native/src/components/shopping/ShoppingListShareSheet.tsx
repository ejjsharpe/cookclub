import { forwardRef } from "react";

import {
  useCancelShoppingListInvitation,
  useGetShoppingListInvitationStatus,
  useGetShoppingListShareableUsers,
  useGetShoppingListShareStatus,
  useInviteToShoppingList,
  useRemoveShoppingListMember,
} from "../../api/shopping";
import {
  ShareResourceSheet,
  type ShareResourceSheetRef,
} from "../ShareResourceSheet";

export interface ShoppingListShareSheetProps {
  shoppingListId?: number;
  listName?: string;
}

export type ShoppingListShareSheetRef = ShareResourceSheetRef;

export const ShoppingListShareSheet = forwardRef<
  ShoppingListShareSheetRef,
  ShoppingListShareSheetProps
>(({ shoppingListId, listName }, ref) => {
  const { data: friends, isLoading: isLoadingUsers } =
    useGetShoppingListShareableUsers();
  const { data: shareStatus, isLoading: isLoadingStatus } =
    useGetShoppingListShareStatus({
      shoppingListId: shoppingListId ?? 0,
      enabled: Boolean(shoppingListId),
    });
  const { data: invitationStatus, isLoading: isLoadingInvitations } =
    useGetShoppingListInvitationStatus({
      shoppingListId: shoppingListId ?? 0,
      enabled: Boolean(shoppingListId),
    });
  const invite = useInviteToShoppingList();
  const cancelInvitation = useCancelShoppingListInvitation();
  const removeMember = useRemoveShoppingListMember();

  return (
    <ShareResourceSheet
      ref={ref}
      title="Share Shopping List"
      subtitle={listName}
      resourceLabel="shopping list"
      resourcePlural="shopping lists"
      friends={friends}
      sharedUserIds={shareStatus?.map(({ userId }) => userId)}
      invitedUserIds={invitationStatus?.map(({ userId }) => userId)}
      isLoading={isLoadingUsers || isLoadingStatus || isLoadingInvitations}
      onInvite={(userId) =>
        shoppingListId
          ? invite.mutateAsync({ shoppingListId, userId })
          : Promise.resolve()
      }
      onCancelInvitation={(userId) =>
        shoppingListId
          ? cancelInvitation.mutateAsync({ shoppingListId, userId })
          : Promise.resolve()
      }
      onRemoveMember={(userId) =>
        shoppingListId
          ? removeMember.mutateAsync({ shoppingListId, userId })
          : Promise.resolve()
      }
    />
  );
});
