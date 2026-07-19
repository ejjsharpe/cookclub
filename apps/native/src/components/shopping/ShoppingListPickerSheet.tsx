import { forwardRef } from "react";

import {
  useCreateShoppingList,
  useDeleteShoppingList,
  useGetUserShoppingLists,
} from "../../api/shopping";
import {
  ResourcePickerSheet,
  type ResourcePickerSheetRef,
} from "../ResourcePickerSheet";

export interface ShoppingListPickerSheetProps {
  activeListId?: number;
  onSelectList?: (listId: number) => void;
}

export type ShoppingListPickerSheetRef = ResourcePickerSheetRef;

export const ShoppingListPickerSheet = forwardRef<
  ShoppingListPickerSheetRef,
  ShoppingListPickerSheetProps
>(({ activeListId, onSelectList }, ref) => {
  const { data: shoppingLists, isLoading } = useGetUserShoppingLists();
  const create = useCreateShoppingList();
  const remove = useDeleteShoppingList();

  return (
    <ResourcePickerSheet
      ref={ref}
      title="Select Shopping List"
      singularLabel="list"
      ownedSectionTitle="Your Lists"
      createTitle="New list name"
      createSubtitle="Create shopping list"
      createPlaceholder="e.g. Weekend BBQ"
      icon="cart-outline"
      activeId={activeListId}
      resources={shoppingLists}
      isLoading={isLoading}
      isCreating={create.isPending}
      onSelect={onSelectList}
      onCreate={(name) => create.mutateAsync({ name })}
      onDelete={(shoppingListId) => remove.mutateAsync({ shoppingListId })}
    />
  );
});
