export const COOK_TIMER_NOTIFICATION_KIND = "cookTimer";
export const COOK_TIMER_NOTIFICATION_CHANNEL_ID = "cook-timer";

export function isCookTimerNotificationData(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    "kind" in data &&
    data.kind === COOK_TIMER_NOTIFICATION_KIND
  );
}
