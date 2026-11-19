import { DefaultTheme } from "@react-navigation/native";
import * as Sentry from "@sentry/react-native";
import { Asset } from "expo-asset";
import { useFonts } from "expo-font";
import { Image } from "expo-image";
import * as Linking from "expo-linking";
import { ShareIntentProvider } from "expo-share-intent";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import React, { useEffect, useRef, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import startImage1 from "@/assets/images/start-food-1.jpg";
import startImage10 from "@/assets/images/start-food-10.jpg";
import startImage11 from "@/assets/images/start-food-11.jpg";
import startImage12 from "@/assets/images/start-food-12.jpg";
import startImage2 from "@/assets/images/start-food-2.jpg";
import startImage3 from "@/assets/images/start-food-3.jpg";
import startImage4 from "@/assets/images/start-food-4.jpg";
import startImage5 from "@/assets/images/start-food-5.jpg";
import startImage6 from "@/assets/images/start-food-6.jpg";
import startImage7 from "@/assets/images/start-food-7.jpg";
import startImage8 from "@/assets/images/start-food-8.jpg";
import startImage9 from "@/assets/images/start-food-9.jpg";
import { WelcomeOverlayProvider } from "@/components/WelcomeOverlay";
import { AddRecipeProvider } from "@/features/add-recipe/AddRecipeProvider";
import { RecipeImportProvider } from "@/features/recipe-import/RecipeImportProvider";
import { ShareIntentImportHandler } from "@/features/recipe-import/ShareIntentImportHandler";
import { activateAdaptyAtStartup } from "@/lib/adapty";
import { CookTimerOverlay, CookTimerProvider } from "@/lib/cook-timer";
import { PushNotificationsProvider } from "@/lib/pushNotifications";
import { ReactQueryProvider } from "@/lib/reactQuery";
import { SessionProvider } from "@/lib/sessionContext";
import { SignedInProvider } from "@/lib/signedInContext";
import { SubscriptionProvider } from "@/lib/subscription";
import { TRPCProvider } from "@/lib/trpc";
import { Navigation, navigationRef } from "@/navigation/RootStack";

const navigationIntegration = Sentry.reactNavigationIntegration({
  enableTimeToInitialDisplay: true,
});

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  environment: __DEV__ ? "development" : "production",
  sendDefaultPii: false,
  tracesSampleRate: __DEV__ ? 0 : 0.1,
  profilesSampleRate: __DEV__ ? 0 : 0.1,
  enableLogs: true,
  integrations: [navigationIntegration],
  enableNativeFramesTracking: true,
  tracePropagationTargets: [
    "localhost",
    /^http:\/\/.*:8787\/trpc/,
    /^https:\/\/api\.cookclub\.app\/trpc/,
  ],
});

SplashScreen.preventAutoHideAsync();
activateAdaptyAtStartup()?.catch((error) => {
  console.log("Adapty activation failed:", error);
  Sentry.captureException(error);
});

const prefix = Linking.createURL("/");
const linking = {
  prefixes: [prefix],
};

function cacheImages(images: any[]) {
  return Promise.all(
    images.map((image) => {
      if (typeof image === "string") {
        return Image.prefetch(image);
      } else {
        return Asset.fromModule(image).downloadAsync();
      }
    }),
  );
}

function App() {
  const [isFontsLoaded, isFontsError] = useFonts({
    "Satoshi-Regular": require("@/assets/fonts/Satoshi/Satoshi-Regular.otf"),
    "Satoshi-Medium": require("@/assets/fonts/Satoshi/Satoshi-Medium.otf"),
    "Satoshi-Bold": require("@/assets/fonts/Satoshi/Satoshi-Bold.otf"),
    "Satoshi-Black": require("@/assets/fonts/Satoshi/Satoshi-Black.otf"),
    "Satoshi-Italic": require("@/assets/fonts/Satoshi/Satoshi-Italic.otf"),
  });
  const isFontsReady = isFontsLoaded || isFontsError;
  const [isImagesReady, setIsImagesReady] = useState(false);
  const [isNavigationReady, setIsNavigationReady] = useState(false);
  const navigationStateRef = useRef<
    React.ComponentProps<typeof Navigation>["initialState"] | undefined
  >(undefined);
  const { theme, rt } = useUnistyles();

  useEffect(() => {
    const loadImages = async () => {
      await cacheImages([
        startImage1,
        startImage2,
        startImage3,
        startImage4,
        startImage5,
        startImage6,
        startImage7,
        startImage8,
        startImage9,
        startImage10,
        startImage11,
        startImage12,
      ]);
      setIsImagesReady(true);
    };
    loadImages();
  }, []);

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(theme.colors.background);
  }, [theme.colors.background]);

  useEffect(() => {
    if (isFontsReady && isNavigationReady && isImagesReady) {
      SplashScreen.hideAsync();
    }
  }, [isFontsReady, isNavigationReady, isImagesReady]);

  const onNavigationReady = () => {
    navigationStateRef.current = navigationRef.getRootState();
    navigationIntegration.registerNavigationContainer(navigationRef);
    setIsNavigationReady(true);
  };
  const navigationKey = `${rt.themeName ?? "theme"}:${theme.colors.background}`;
  const navigationTheme = {
    dark: rt.themeName === "dark",
    fonts: DefaultTheme.fonts,
    colors: {
      primary: theme.colors.primary,
      background: theme.colors.background,
      card: theme.colors.background,
      text: theme.colors.text,
      border: theme.colors.border,
      notification: theme.colors.primary,
    },
  };

  if (!isFontsReady) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <KeyboardProvider>
        <ShareIntentProvider>
          <ReactQueryProvider>
            <SessionProvider>
              <TRPCProvider>
                <SignedInProvider>
                  <SubscriptionProvider>
                    <PushNotificationsProvider>
                      <RecipeImportProvider>
                        <GestureHandlerRootView style={styles.rootView}>
                          <CookTimerProvider>
                            <WelcomeOverlayProvider>
                              <AddRecipeProvider>
                                <ShareIntentImportHandler />
                                <Navigation
                                  ref={navigationRef}
                                  key={navigationKey}
                                  onReady={onNavigationReady}
                                  initialState={navigationStateRef.current}
                                  onStateChange={(state) => {
                                    navigationStateRef.current = state;
                                  }}
                                  linking={linking}
                                  theme={navigationTheme}
                                />
                              </AddRecipeProvider>
                            </WelcomeOverlayProvider>
                            <CookTimerOverlay />
                          </CookTimerProvider>
                        </GestureHandlerRootView>
                      </RecipeImportProvider>
                    </PushNotificationsProvider>
                  </SubscriptionProvider>
                </SignedInProvider>
              </TRPCProvider>
            </SessionProvider>
          </ReactQueryProvider>
        </ShareIntentProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}

export default Sentry.wrap(App);

const styles = StyleSheet.create((theme) => ({
  rootView: { flex: 1, backgroundColor: theme.colors.background },
}));
