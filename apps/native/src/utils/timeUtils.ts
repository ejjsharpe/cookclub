import { formatDuration } from "date-fns";

/**
 * Format minutes into a human-readable string
 * e.g., 15 -> "15 minutes", 60 -> "1 hour", 90 -> "1 hour 30 minutes"
 */
export function formatMinutes(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) {
    return "";
  }

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  return formatDuration(
    { hours, minutes: mins },
    {
      format:
        hours > 0 && mins > 0
          ? ["hours", "minutes"]
          : hours > 0
            ? ["hours"]
            : ["minutes"],
      delimiter: " ",
    },
  );
}

/**
 * Format minutes into a short human-readable string
 * e.g., 15 -> "15 min", 60 -> "1 hr", 90 -> "1 hr 30 min"
 */
export function formatMinutesShort(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) {
    return "";
  }

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hours > 0 && mins > 0) {
    return `${hours} hr ${mins} min`;
  } else if (hours > 0) {
    return `${hours} hr`;
  } else {
    return `${mins} min`;
  }
}
