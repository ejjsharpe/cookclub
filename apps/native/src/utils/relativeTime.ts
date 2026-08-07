export function formatRelativeTimeShort(
  value: Date | string | number,
  now = new Date(),
): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";

  const elapsedSeconds = Math.max(
    0,
    Math.floor((now.getTime() - timestamp) / 1000),
  );
  if (elapsedSeconds < 60) return "now";

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) return `${elapsedDays}d`;
  if (elapsedDays < 365) return `${Math.floor(elapsedDays / 7)}w`;

  return `${Math.floor(elapsedDays / 365)}y`;
}
