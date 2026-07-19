import * as Notifications from "expo-notifications";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { Alert, Linking, Platform, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";

import {
  COOK_TIMER_NOTIFICATION_CHANNEL_ID,
  COOK_TIMER_NOTIFICATION_KIND,
} from "./cook-timer-notifications";
import { storage } from "./mmkv";
import { useSessionContext } from "./sessionContext";

import { Ionicons } from "@/components/Ionicons";
import { Text } from "@/components/Text";

const COOK_TIMER_STORAGE_KEY = "cook_timer";

interface CookTimer {
  recipeName: string;
  durationSeconds: number;
  remainingSeconds: number;
  endsAt: number | null;
  isPaused: boolean;
  notificationId: string | null;
}

interface StartCookTimerInput {
  recipeName: string;
  durationSeconds: number;
}

interface CookTimerContextValue {
  timer: CookTimer | null;
  startTimer: (input: StartCookTimerInput) => Promise<void>;
  pauseTimer: () => void;
  resumeTimer: () => Promise<void>;
  clearTimer: () => void;
}

const CookTimerContext = createContext<CookTimerContextValue | null>(null);

const getRemainingSeconds = (endsAt: number) =>
  Math.max(Math.ceil((endsAt - Date.now()) / 1000), 0);

const createCookTimerNotificationId = (endsAt: number) =>
  `cook-timer-${endsAt}`;

const formatCookTimer = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds
      .toString()
      .padStart(2, "0")}`;
  }

  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
};

function parseStoredCookTimer(): CookTimer | null {
  const stored = storage.getString(COOK_TIMER_STORAGE_KEY);
  if (!stored) return null;

  try {
    const parsed = JSON.parse(stored) as Partial<CookTimer>;
    const recipeName =
      typeof parsed.recipeName === "string" ? parsed.recipeName : null;
    const durationSeconds =
      typeof parsed.durationSeconds === "number" ? parsed.durationSeconds : 0;
    const remainingSeconds =
      typeof parsed.remainingSeconds === "number" ? parsed.remainingSeconds : 0;
    const endsAt = typeof parsed.endsAt === "number" ? parsed.endsAt : null;
    const isPaused = parsed.isPaused === true;
    const notificationId =
      typeof parsed.notificationId === "string" ? parsed.notificationId : null;

    if (!recipeName || durationSeconds <= 0) {
      storage.delete(COOK_TIMER_STORAGE_KEY);
      return null;
    }

    if (!isPaused && endsAt) {
      const activeRemainingSeconds = getRemainingSeconds(endsAt);
      if (activeRemainingSeconds <= 0) {
        storage.delete(COOK_TIMER_STORAGE_KEY);
        return null;
      }

      return {
        recipeName,
        durationSeconds,
        remainingSeconds: activeRemainingSeconds,
        endsAt,
        isPaused: false,
        notificationId,
      };
    }

    if (isPaused && remainingSeconds > 0) {
      return {
        recipeName,
        durationSeconds,
        remainingSeconds,
        endsAt: null,
        isPaused: true,
        notificationId: null,
      };
    }
  } catch (error) {
    console.warn("Failed to read stored cook timer", error);
  }

  storage.delete(COOK_TIMER_STORAGE_KEY);
  return null;
}

function persistCookTimer(timer: CookTimer | null) {
  if (!timer) {
    storage.delete(COOK_TIMER_STORAGE_KEY);
    return;
  }

  storage.set(COOK_TIMER_STORAGE_KEY, JSON.stringify(timer));
}

async function cancelScheduledTimerNotification(notificationId: string | null) {
  if (!notificationId) return;

  try {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  } catch (error) {
    console.warn("Failed to cancel cook timer notification", error);
  }
}

function canSendTimerNotification(
  permissions: Notifications.NotificationPermissionsStatus,
) {
  if (!permissions.granted && permissions.status !== "granted") {
    return false;
  }

  if (Platform.OS === "ios") {
    return (
      permissions.ios?.allowsAlert !== false &&
      permissions.ios?.allowsSound !== false
    );
  }

  if (Platform.OS === "android") {
    return (
      permissions.android?.importance !== Notifications.AndroidImportance.NONE
    );
  }

  return true;
}

function canUseAndroidTimerChannel(
  channel: Notifications.NotificationChannel | null,
) {
  if (Platform.OS !== "android") {
    return true;
  }

  return (
    channel !== null &&
    channel.importance !== Notifications.AndroidImportance.NONE &&
    channel.sound !== null
  );
}

function showTimerNotificationPermissionsAlert() {
  Alert.alert(
    "Timer notifications are off",
    "The timer will keep running in the app, but cookclub cannot alert you in the background until notifications with sound are enabled.",
    [
      { text: "Not now", style: "cancel" },
      {
        text: "Open Settings",
        onPress: () => {
          Linking.openSettings().catch((error) => {
            console.warn("Failed to open notification settings", error);
          });
        },
      },
    ],
  );
}

function showTimerNotificationScheduleError() {
  Alert.alert(
    "Timer notification was not scheduled",
    "The timer will keep running in the app, but cookclub could not queue a background notification for it.",
  );
}

async function ensureTimerNotificationPermissions() {
  let androidTimerChannel: Notifications.NotificationChannel | null = null;

  if (Platform.OS === "android") {
    androidTimerChannel = await Notifications.setNotificationChannelAsync(
      COOK_TIMER_NOTIFICATION_CHANNEL_ID,
      {
        name: "Cook timers",
        importance: Notifications.AndroidImportance.MAX,
        sound: "default",
        audioAttributes: {
          usage: Notifications.AndroidAudioUsage.ALARM,
          contentType: Notifications.AndroidAudioContentType.SONIFICATION,
        },
        enableVibrate: true,
        lockscreenVisibility:
          Notifications.AndroidNotificationVisibility.PUBLIC,
        vibrationPattern: [0, 250, 250, 250],
      },
    );
  }

  const existingPermissions = await Notifications.getPermissionsAsync();
  if (
    canSendTimerNotification(existingPermissions) &&
    canUseAndroidTimerChannel(androidTimerChannel)
  ) {
    return true;
  }

  const requestedPermissions = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowSound: true,
    },
  });

  return (
    canSendTimerNotification(requestedPermissions) &&
    canUseAndroidTimerChannel(androidTimerChannel)
  );
}

async function scheduleTimerNotification(params: {
  identifier: string;
  recipeName: string;
  endsAt: number;
}) {
  const hasPermission = await ensureTimerNotificationPermissions();

  if (!hasPermission) {
    showTimerNotificationPermissionsAlert();
    return null;
  }

  const notificationId = await Notifications.scheduleNotificationAsync({
    identifier: params.identifier,
    content: {
      title: "Timer done",
      body: `${params.recipeName} is ready.`,
      sound: "default",
      priority: Notifications.AndroidNotificationPriority.HIGH,
      interruptionLevel: "timeSensitive",
      data: {
        kind: COOK_TIMER_NOTIFICATION_KIND,
        recipeName: params.recipeName,
        endsAt: params.endsAt,
      },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: Math.max(params.endsAt, Date.now() + 1000),
      channelId: COOK_TIMER_NOTIFICATION_CHANNEL_ID,
    },
  });

  if (__DEV__) {
    const scheduledNotifications =
      await Notifications.getAllScheduledNotificationsAsync();
    const isQueued = scheduledNotifications.some(
      (notification) => notification.identifier === notificationId,
    );

    if (!isQueued) {
      console.warn("Cook timer notification was not found after scheduling", {
        notificationId,
      });
    }
  }

  return notificationId;
}

export function CookTimerProvider({ children }: PropsWithChildren) {
  const sessionContext = useSessionContext();
  const [timer, setTimer] = useState<CookTimer | null>(parseStoredCookTimer);
  const timerRef = useRef<CookTimer | null>(timer);

  useEffect(() => {
    timerRef.current = timer;
    persistCookTimer(timer);
  }, [timer]);

  const clearTimer = useCallback(() => {
    const notificationId = timerRef.current?.notificationId ?? null;
    setTimer(null);
    cancelScheduledTimerNotification(notificationId).catch(() => {});
  }, []);

  useEffect(() => {
    if (!sessionContext?.user.id && timerRef.current) {
      clearTimer();
    }
  }, [clearTimer, sessionContext?.user.id]);

  const scheduleAndApplyTimerNotification = useCallback(
    async (params: { endsAt: number; recipeName: string }) => {
      let notificationId: string | null = null;

      try {
        notificationId = await scheduleTimerNotification({
          identifier: createCookTimerNotificationId(params.endsAt),
          recipeName: params.recipeName,
          endsAt: params.endsAt,
        });
      } catch (error) {
        console.warn("Failed to schedule cook timer notification", error);
        showTimerNotificationScheduleError();
      }

      if (!notificationId) return;

      setTimer((currentTimer) => {
        if (
          !currentTimer ||
          currentTimer.endsAt !== params.endsAt ||
          currentTimer.isPaused
        ) {
          cancelScheduledTimerNotification(notificationId).catch(() => {});
          return currentTimer;
        }

        return {
          ...currentTimer,
          notificationId,
        };
      });
    },
    [],
  );

  const startTimer = useCallback(
    async ({ recipeName, durationSeconds }: StartCookTimerInput) => {
      if (durationSeconds <= 0) return;

      const previousNotificationId = timerRef.current?.notificationId ?? null;
      const endsAt = Date.now() + durationSeconds * 1000;

      setTimer({
        recipeName,
        durationSeconds,
        remainingSeconds: durationSeconds,
        endsAt,
        isPaused: false,
        notificationId: null,
      });
      cancelScheduledTimerNotification(previousNotificationId).catch(() => {});

      await scheduleAndApplyTimerNotification({
        endsAt,
        recipeName,
      });
    },
    [scheduleAndApplyTimerNotification],
  );

  const pauseTimer = useCallback(() => {
    const notificationId = timerRef.current?.notificationId ?? null;

    setTimer((currentTimer) => {
      if (!currentTimer?.endsAt || currentTimer.isPaused) {
        return currentTimer;
      }

      return {
        ...currentTimer,
        remainingSeconds: getRemainingSeconds(currentTimer.endsAt),
        endsAt: null,
        isPaused: true,
        notificationId: null,
      };
    });

    cancelScheduledTimerNotification(notificationId).catch(() => {});
  }, []);

  const resumeTimer = useCallback(async () => {
    const currentTimer = timerRef.current;
    if (!currentTimer || !currentTimer.isPaused) return;

    const endsAt = Date.now() + currentTimer.remainingSeconds * 1000;

    setTimer({
      ...currentTimer,
      endsAt,
      isPaused: false,
      notificationId: null,
    });

    await scheduleAndApplyTimerNotification({
      endsAt,
      recipeName: currentTimer.recipeName,
    });
  }, [scheduleAndApplyTimerNotification]);

  useEffect(() => {
    if (!timer?.endsAt || timer.isPaused) {
      return;
    }

    const endsAt = timer.endsAt;

    const tick = () => {
      const nextRemainingSeconds = getRemainingSeconds(endsAt);

      if (nextRemainingSeconds <= 0) {
        setTimer((currentTimer) => {
          if (!currentTimer || currentTimer.endsAt !== endsAt) {
            return currentTimer;
          }

          if (!currentTimer.notificationId) {
            Alert.alert("Timer done", "Your cook mode timer has finished.");
          }

          return null;
        });
        return;
      }

      setTimer((currentTimer) => {
        if (!currentTimer || currentTimer.endsAt !== endsAt) {
          return currentTimer;
        }

        return {
          ...currentTimer,
          remainingSeconds: nextRemainingSeconds,
        };
      });
    };

    tick();
    const interval = setInterval(tick, 1000);

    return () => clearInterval(interval);
  }, [timer?.endsAt, timer?.isPaused]);

  const value = useMemo(
    () => ({
      timer,
      startTimer,
      pauseTimer,
      resumeTimer,
      clearTimer,
    }),
    [clearTimer, pauseTimer, resumeTimer, startTimer, timer],
  );

  return (
    <CookTimerContext.Provider value={value}>
      {children}
    </CookTimerContext.Provider>
  );
}

export function useCookTimer() {
  const context = useContext(CookTimerContext);
  if (!context) {
    throw new Error("useCookTimer must be used within CookTimerProvider");
  }
  return context;
}

export function CookTimerOverlay({ topOffset = 10 }: { topOffset?: number }) {
  const { timer, pauseTimer, resumeTimer, clearTimer } = useCookTimer();
  const insets = useSafeAreaInsets();
  const handleToggleTimer = useCallback(() => {
    if (timer?.isPaused) {
      resumeTimer().catch((error) => {
        console.warn("Failed to resume cook timer", error);
      });
      return;
    }

    pauseTimer();
  }, [pauseTimer, resumeTimer, timer?.isPaused]);

  if (!timer) return null;

  return (
    <View pointerEvents="box-none" style={styles.overlay}>
      <View
        pointerEvents="auto"
        style={[
          styles.panel,
          {
            top: Math.max(insets.top, 12) + topOffset,
          },
        ]}
      >
        <View style={styles.timerStatus}>
          <Ionicons name="timer-outline" size={15} style={styles.timerIcon} />
          <Text style={styles.timerText}>
            {formatCookTimer(timer.remainingSeconds)}
          </Text>
        </View>
        <View style={styles.timerControls}>
          <TouchableOpacity
            style={styles.timerControlButton}
            onPress={handleToggleTimer}
            accessibilityRole="button"
            accessibilityLabel={timer.isPaused ? "Resume timer" : "Pause timer"}
          >
            <Ionicons
              name={timer.isPaused ? "play" : "pause"}
              size={16}
              style={styles.timerControlIcon}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.timerControlButton}
            onPress={clearTimer}
            accessibilityRole="button"
            accessibilityLabel="Clear timer"
          >
            <Ionicons name="close" size={18} style={styles.timerControlIcon} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 80,
  },
  panel: {
    position: "absolute",
    alignSelf: "center",
    maxWidth: 240,
    minHeight: 42,
    borderRadius: theme.borderRadius.full,
    borderCurve: "continuous",
    backgroundColor: theme.colors.text,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingLeft: 14,
    paddingRight: 8,
    paddingVertical: 6,
    boxShadow: "0 6px 18px rgba(0, 0, 0, 0.14)",
  },
  timerStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  timerIcon: {
    color: theme.colors.background,
  },
  timerText: {
    color: theme.colors.background,
    fontSize: 17,
    lineHeight: 22,
    fontFamily: theme.fonts.bold,
    fontVariant: ["tabular-nums"],
  },
  timerControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  timerControlButton: {
    width: 30,
    height: 30,
    borderRadius: theme.borderRadius.full,
    backgroundColor: "rgba(255, 255, 255, 0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  timerControlIcon: {
    color: theme.colors.background,
  },
}));
