import { Ionicons } from "@expo/vector-icons";
import { createNativeBottomTabNavigator } from "@react-navigation/bottom-tabs/unstable";
import { useEffect, useState } from "react";
import type { ImageSourcePropType } from "react-native";
import { useUnistyles } from "react-native-unistyles";

import type { TabParamList } from "@/navigation/navigationRef";
import { AddRecipeScreen } from "@/screens/AddRecipeScreen";
import { HomeScreen } from "@/screens/HomeScreen";
import { MealPlanScreen } from "@/screens/MealPlanScreen";
import { MyRecipesScreen } from "@/screens/MyRecipesScreen";
import { ShoppingListScreen } from "@/screens/ShoppingListScreen";

const Tab = createNativeBottomTabNavigator<TabParamList>();

const TAB_ICON_NAMES = {
  Home: "home",
  Recipes: "book",
  "Add recipe": "add-circle",
  "Meal Plan": "calendar",
  "Shopping List": "cart",
} as const satisfies Record<keyof TabParamList, keyof typeof Ionicons.glyphMap>;

type TabIconSources = Partial<Record<keyof TabParamList, ImageSourcePropType>>;

async function loadTabIconSources(): Promise<TabIconSources> {
  const entries = await Promise.all(
    Object.entries(TAB_ICON_NAMES).map(async ([routeName, iconName]) => {
      const source = await Ionicons.getImageSource(iconName, 24, "#000000");
      return [routeName, source] as const;
    }),
  );

  return Object.fromEntries(
    entries.filter((entry) => entry[1] !== null),
  ) as TabIconSources;
}

export const TabNavigator = () => {
  const { theme } = useUnistyles();
  const [tabIcons, setTabIcons] = useState<TabIconSources>({});

  useEffect(() => {
    let isMounted = true;

    loadTabIconSources()
      .then((sources) => {
        if (isMounted) {
          setTabIcons(sources);
        }
      })
      .catch((error: unknown) => {
        console.warn("Unable to load Android tab icons", error);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarLabelVisibilityMode: "labeled",
        tabBarStyle: {
          backgroundColor: theme.colors.tabBarBackground,
        },
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textSecondary,
        tabBarActiveIndicatorColor: theme.colors.background,
        tabBarLabelStyle: {
          fontFamily: theme.fonts.medium,
          fontSize: 12,
        },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarIcon: tabIcons.Home
            ? { type: "image", source: tabIcons.Home }
            : undefined,
        }}
      />
      <Tab.Screen
        name="Recipes"
        component={MyRecipesScreen}
        options={{
          tabBarIcon: tabIcons.Recipes
            ? { type: "image", source: tabIcons.Recipes }
            : undefined,
        }}
      />
      <Tab.Screen
        name="Add recipe"
        component={AddRecipeScreen}
        options={{
          tabBarLabel: "Add",
          tabBarIcon: tabIcons["Add recipe"]
            ? { type: "image", source: tabIcons["Add recipe"] }
            : undefined,
        }}
      />
      <Tab.Screen
        name="Meal Plan"
        component={MealPlanScreen}
        options={{
          tabBarLabel: "Plan",
          tabBarIcon: tabIcons["Meal Plan"]
            ? { type: "image", source: tabIcons["Meal Plan"] }
            : undefined,
        }}
      />
      <Tab.Screen
        name="Shopping List"
        component={ShoppingListScreen}
        options={{
          tabBarLabel: "Shop",
          tabBarIcon: tabIcons["Shopping List"]
            ? { type: "image", source: tabIcons["Shopping List"] }
            : undefined,
        }}
      />
    </Tab.Navigator>
  );
};
