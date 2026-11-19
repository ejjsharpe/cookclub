import { Ionicons } from "@expo/vector-icons";
import { createNativeBottomTabNavigator } from "@react-navigation/bottom-tabs/unstable";
import { useEffect, useState } from "react";
import type { ImageSourcePropType } from "react-native";
import { useUnistyles } from "react-native-unistyles";

import type { TabParamList } from "@/navigation/navigationRef";
import { signatureTabIcon } from "@/navigation/tabIcons";
import { AddRecipeScreen } from "@/screens/AddRecipeScreen";
import { HomeScreen } from "@/screens/HomeScreen";
import { MealPlanScreen } from "@/screens/MealPlanScreen";
import { MyRecipesScreen } from "@/screens/MyRecipesScreen";
import { ShoppingListScreen } from "@/screens/ShoppingListScreen";

const Tab = createNativeBottomTabNavigator<TabParamList>();

// The signature icons cover every tab except Add, which stays a system icon.
const TAB_ICON_NAMES = {
  "Add recipe": "add-circle",
} as const satisfies Partial<
  Record<keyof TabParamList, keyof typeof Ionicons.glyphMap>
>;

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
          tabBarIcon: signatureTabIcon("home"),
        }}
      />
      <Tab.Screen
        name="Recipes"
        component={MyRecipesScreen}
        options={{
          tabBarIcon: signatureTabIcon("recipes"),
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
          tabBarIcon: signatureTabIcon("plan"),
        }}
      />
      <Tab.Screen
        name="Shopping List"
        component={ShoppingListScreen}
        options={{
          tabBarLabel: "Shop",
          tabBarIcon: signatureTabIcon("shop"),
        }}
      />
    </Tab.Navigator>
  );
};
