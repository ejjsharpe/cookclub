import type { Outputs } from "@repo/trpc/client";
import { useTRPC } from "@repo/trpc/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert } from "react-native";

// API Response Types
export type MealPlanEntry = Outputs["mealPlan"]["getEntries"][number];
export type ShareStatus = Outputs["mealPlan"]["getShareStatus"][number];
export type MealPlan = Outputs["mealPlan"]["getMealPlans"][number];
export type MealTime = MealPlan["mealTimes"][number];

// Get all meal plans (owned + shared with user)
export const useGetMealPlans = () => {
  const trpc = useTRPC();
  return useQuery({
    ...trpc.mealPlan.getMealPlans.queryOptions(),
  });
};

// Create a new meal plan
export const useCreateMealPlan = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const mutationOptions = trpc.mealPlan.createMealPlan.mutationOptions({
    onSuccess: () => {
      const plansFilter = trpc.mealPlan.getMealPlans.pathFilter();
      queryClient.invalidateQueries(plansFilter);
    },
    onError: () => {
      Alert.alert("Error", "Failed to create meal plan. Please try again.");
    },
  });

  return useMutation(mutationOptions);
};

// Delete a meal plan
export const useDeleteMealPlan = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const mutationOptions = trpc.mealPlan.deleteMealPlan.mutationOptions({
    onSuccess: async (_data, variables) => {
      queryClient.removeQueries(
        trpc.mealPlan.getEntries.queryFilter({
          mealPlanId: variables.mealPlanId,
        }),
      );
      await queryClient.invalidateQueries(
        trpc.mealPlan.getMealPlans.pathFilter(),
      );
    },
    onError: () => {
      Alert.alert("Error", "Failed to delete meal plan. Please try again.");
    },
  });

  return useMutation(mutationOptions);
};

// Replace one plan's meal times in the cached plan list
const setPlanMealTimes = (
  plans: MealPlan[] | undefined,
  mealPlanId: number,
  mealTimes: MealTime[],
) => plans?.map((p) => (p.id === mealPlanId ? { ...p, mealTimes } : p));

const errorMessage = (err: unknown, fallback: string) =>
  err instanceof Error && err.message ? err.message : fallback;

// Add a custom meal time (e.g. "Supper") to a plan
export const useAddMealTime = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const mutationOptions = trpc.mealPlan.addMealTime.mutationOptions({
    onSuccess: (data, variables) => {
      queryClient.setQueryData(trpc.mealPlan.getMealPlans.queryKey(), (plans) =>
        setPlanMealTimes(plans, variables.mealPlanId, data.mealTimes),
      );
    },
    onError: (err) => {
      Alert.alert(
        "Couldn't add meal time",
        errorMessage(err, "Please try again."),
      );
    },
  });

  return useMutation(mutationOptions);
};

// Reorder, hide, rename or remove a plan's meal times (applied straight away)
export const useUpdateMealTimes = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const plansKey = trpc.mealPlan.getMealPlans.queryKey();

  const mutationOptions = trpc.mealPlan.updateMealTimes.mutationOptions({
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: plansKey });
      const previous = queryClient.getQueryData(plansKey);
      queryClient.setQueryData(plansKey, (plans) =>
        plans?.map((p) => {
          if (p.id !== variables.mealPlanId) return p;
          const byKey = new Map(p.mealTimes.map((t) => [t.key, t]));
          const mealTimes = variables.mealTimes.flatMap((t) => {
            const existing = byKey.get(t.key);
            if (!existing) return [];
            const { hidden: _hidden, ...rest } = existing;
            return [
              t.hidden
                ? { ...rest, name: t.name, hidden: true }
                : { ...rest, name: t.name },
            ];
          });
          return { ...p, mealTimes };
        }),
      );
      return { previous };
    },
    onError: (err, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(plansKey, context.previous);
      }
      Alert.alert(
        "Couldn't update meal times",
        errorMessage(err, "Please try again."),
      );
    },
    onSuccess: (mealTimes, variables) => {
      queryClient.setQueryData(plansKey, (plans) =>
        setPlanMealTimes(plans, variables.mealPlanId, mealTimes),
      );
    },
  });

  return useMutation(mutationOptions);
};

// Get entries for a meal plan within a date range
interface UseGetMealPlanEntriesParams {
  mealPlanId: number;
  startDate: string;
  endDate: string;
  enabled?: boolean;
}

export const useGetMealPlanEntries = ({
  mealPlanId,
  startDate,
  endDate,
  enabled = true,
}: UseGetMealPlanEntriesParams) => {
  const trpc = useTRPC();

  return useQuery({
    ...trpc.mealPlan.getEntries.queryOptions(
      { mealPlanId, startDate, endDate },
      { enabled },
    ),

    // Keep previous data while loading new date range to prevent flash
    placeholderData: (previousData) => previousData,
  });
};

// Add a recipe to a meal slot
export const useAddRecipeToMealPlan = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const mutationOptions = trpc.mealPlan.addRecipe.mutationOptions({
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries(
        trpc.mealPlan.getEntries.queryFilter({
          mealPlanId: variables.mealPlanId,
        }),
      );
    },
    onError: () => {
      Alert.alert(
        "Error",
        "Failed to add recipe to meal plan. Please try again.",
      );
    },
  });

  return useMutation(mutationOptions);
};

// Remove an entry from meal plan
export const useRemoveFromMealPlan = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const mutationOptions = trpc.mealPlan.removeEntry.mutationOptions({
    onMutate: async (variables) => {
      const entriesFilter = trpc.mealPlan.getEntries.pathFilter();
      await queryClient.cancelQueries(entriesFilter);

      // Snapshot all matching queries before mutation
      const previousDataMap = new Map<string, MealPlanEntry[]>();
      const cache = queryClient.getQueriesData<MealPlanEntry[]>(entriesFilter);
      cache.forEach(([queryKey, data]) => {
        if (data) {
          previousDataMap.set(JSON.stringify(queryKey), data);
        }
      });

      // Optimistically remove the entry from cache
      queryClient.setQueriesData<MealPlanEntry[]>(entriesFilter, (old) => {
        if (!old) return old;
        return old.filter((entry) => entry.id !== variables.entryId);
      });

      return { previousDataMap };
    },
    onError: (_err, _variables, context) => {
      // Rollback on error using the snapshot map
      if (context?.previousDataMap) {
        context.previousDataMap.forEach((data, queryKeyStr) => {
          const queryKey = JSON.parse(queryKeyStr);
          queryClient.setQueryData(queryKey, data);
        });
      }
      Alert.alert("Error", "Failed to remove entry. Please try again.");
    },
    onSettled: () => {
      const entriesFilter = trpc.mealPlan.getEntries.pathFilter();
      return queryClient.invalidateQueries(entriesFilter);
    },
  });

  return useMutation(mutationOptions);
};

// Get shareable users (friends)
export const useGetShareableUsers = () => {
  const trpc = useTRPC();
  return useQuery(trpc.mealPlan.getShareableUsers.queryOptions());
};

// Invite a friend to a meal plan
export const useInviteToMealPlan = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const mutationOptions = trpc.mealPlan.inviteToMealPlan.mutationOptions({
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: trpc.mealPlan.getMealPlanInvitationStatus.queryKey({
          mealPlanId: variables.mealPlanId,
        }),
        exact: true,
      });
    },
    onError: () => {
      Alert.alert("Error", "Failed to send invitation. Please try again.");
    },
  });

  return useMutation(mutationOptions);
};

// Cancel a pending invitation
export const useCancelMealPlanInvitation = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const mutationOptions =
    trpc.mealPlan.cancelMealPlanInvitation.mutationOptions({
      onSuccess: (_data, variables) => {
        queryClient.invalidateQueries({
          queryKey: trpc.mealPlan.getMealPlanInvitationStatus.queryKey({
            mealPlanId: variables.mealPlanId,
          }),
          exact: true,
        });
      },
      onError: () => {
        Alert.alert("Error", "Failed to cancel invitation. Please try again.");
      },
    });

  return useMutation(mutationOptions);
};

// Accept a meal plan invitation
export const useAcceptMealPlanInvitation = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const mutationOptions =
    trpc.mealPlan.acceptMealPlanInvitation.mutationOptions({
      onSuccess: () => {
        const plansFilter = trpc.mealPlan.getMealPlans.pathFilter();
        const pendingFilter =
          trpc.mealPlan.getPendingMealPlanInvitations.pathFilter();
        queryClient.invalidateQueries(plansFilter);
        queryClient.invalidateQueries(pendingFilter);
      },
      onError: () => {
        Alert.alert("Error", "Failed to accept invitation. Please try again.");
      },
    });

  return useMutation(mutationOptions);
};

// Decline a meal plan invitation
export const useDeclineMealPlanInvitation = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const mutationOptions =
    trpc.mealPlan.declineMealPlanInvitation.mutationOptions({
      onSuccess: () => {
        const pendingFilter =
          trpc.mealPlan.getPendingMealPlanInvitations.pathFilter();
        queryClient.invalidateQueries(pendingFilter);
      },
      onError: () => {
        Alert.alert("Error", "Failed to decline invitation. Please try again.");
      },
    });

  return useMutation(mutationOptions);
};

// Remove a member from a meal plan
export const useRemoveMealPlanMember = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const mutationOptions = trpc.mealPlan.removeMealPlanMember.mutationOptions({
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: trpc.mealPlan.getShareStatus.queryKey({
          mealPlanId: variables.mealPlanId,
        }),
        exact: true,
      });
    },
    onError: () => {
      Alert.alert("Error", "Failed to remove member. Please try again.");
    },
  });

  return useMutation(mutationOptions);
};

// Get pending meal plan invitations for the current user
export const useGetPendingMealPlanInvitations = () => {
  const trpc = useTRPC();
  return useQuery(trpc.mealPlan.getPendingMealPlanInvitations.queryOptions());
};

// Get invitation status for a meal plan (for share sheet)
export const useGetMealPlanInvitationStatus = ({
  mealPlanId,
  enabled = true,
}: {
  mealPlanId: number;
  enabled?: boolean;
}) => {
  const trpc = useTRPC();
  return useQuery(
    trpc.mealPlan.getMealPlanInvitationStatus.queryOptions(
      { mealPlanId },
      { enabled },
    ),
  );
};

// Get share status for a meal plan (accepted members)
export const useGetShareStatus = ({
  mealPlanId,
  enabled = true,
}: {
  mealPlanId: number;
  enabled?: boolean;
}) => {
  const trpc = useTRPC();
  return useQuery(
    trpc.mealPlan.getShareStatus.queryOptions({ mealPlanId }, { enabled }),
  );
};
