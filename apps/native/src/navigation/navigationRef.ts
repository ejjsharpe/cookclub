import {
  createNavigationContainerRef,
  type ParamListBase,
} from "@react-navigation/native";

import type { ParsedRecipe } from "@/api/recipe";

export interface AppParamList extends ParamListBase {
  Tabs: undefined;
  Home: undefined;
  Recipes: undefined;
  "Add recipe": undefined;
  "Meal Plan": undefined;
  "Shopping List": undefined;
  Start: undefined;
  Onboarding: undefined;
  Settings: undefined;
  Notifications: undefined;
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
        importJobId?: string;
      }
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
}

declare global {
  namespace ReactNavigation {
    interface RootParamList extends AppParamList {}
  }
}

export const navigationRef = createNavigationContainerRef<AppParamList>();
