import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Session } from "better-auth";
import * as Linking from "expo-linking";
import { createContext, useContext, useEffect } from "react";
import { Alert } from "react-native";

import { authClient } from "./authClient";
import { consumeEmailVerificationCallback } from "./emailVerificationCallback";

interface User {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
  image?: string | null | undefined | undefined;
}

const SessionContext = createContext<{ user: User; session: Session } | null>(
  null,
);

export const useSessionContext = () => useContext(SessionContext);

export const SessionProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery({
    queryKey: ["session"],
    queryFn: async () => {
      const result = await authClient.getSession();

      return result.data;
    },
  });

  useEffect(() => {
    let isMounted = true;

    const handleCallback = async (url: string) => {
      try {
        const result = consumeEmailVerificationCallback(url);
        if (!result.handled || !isMounted) return;

        if (result.status === "error") {
          Alert.alert("Verification failed", result.message);
          return;
        }

        await queryClient.invalidateQueries({ queryKey: ["session"] });
        if (!isMounted || queryClient.getQueryData(["session"])) return;

        if (result.status === "verified-without-session") {
          Alert.alert("Email verified", result.message);
          return;
        }

        Alert.alert(
          "Sign in required",
          "Your email is verified, but we couldn't finish signing you in. Please sign in to continue.",
        );
      } catch {
        if (isMounted) {
          Alert.alert(
            "Sign in required",
            "Your email may be verified, but we couldn't finish signing you in. Please sign in to continue.",
          );
        }
      }
    };

    Linking.getInitialURL()
      .then((url) => {
        if (url) return handleCallback(url);
      })
      .catch(() => {});

    const subscription = Linking.addEventListener("url", ({ url }) => {
      handleCallback(url).catch(() => {});
    });

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, [queryClient]);

  // Only block on initial load, don't block forever on error
  if (isPending) return null;

  return (
    <SessionContext.Provider value={data ?? null}>
      {children}
    </SessionContext.Provider>
  );
};
