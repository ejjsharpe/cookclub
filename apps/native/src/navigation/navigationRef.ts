import {
  createNavigationContainerRef,
  type NavigatorScreenParams,
} from "@react-navigation/native";

import type { ParsedRecipe } from "@/api/recipe";
import type { ActivityNotificationTarget } from "@/lib/activityNotification";

export type TabParamList = {
  Home: undefined;
  Recipes: undefined;
  "Add recipe": undefined;
  "Meal Plan": undefined;
  "Shopping List": undefined;
};

type ActivityScreenParams = ActivityNotificationTarget & {
  focusCommentInput?: boolean;
};

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList> | undefined;
  Start: undefined;
  Onboarding: undefined;
  Settings: undefined;
  BlockedUsers: undefined;
  Notifications: undefined;
  FindCooks: undefined;
  Activity: ActivityScreenParams;
  GenerateRecipe: undefined;
  UserProfile: { userId: string };
  FollowsList: {
    userId: string;
    activeTab: "following" | "followers";
    userName: string;
  };
  RecipeDetail:
    | { recipeId: number; mode?: "view" | "edit" }
    | {
        parsedRecipe: ParsedRecipe;
        mode?: "view" | "edit";
        generatedImage?: {
          publicUrl: string;
          imageUploadId: string;
        };
      }
    | { importJobId: string; mode?: "view" | "edit" }
    | { draft: true; mode: "edit" };
  CollectionDetail: { collectionId: number };
  Account: undefined;
  EmailVerification: { email: string };
  CookMode: {
    recipeName: string;
    ingredientSections: {
      id: number;
      name: string | null;
      ingredients: {
        id: number;
        quantity: string | null;
        unit: string | null;
        name: string;
        preparation: string | null;
      }[];
    }[];
    instructionSections: {
      id: number;
      name: string | null;
      instructions: {
        id: number;
        instruction: string;
        imageUrl?: string | null;
      }[];
    }[];
  };
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}

export const navigationRef = createNavigationContainerRef<RootStackParamList>();
