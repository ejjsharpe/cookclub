/** Password reset callback paths contain a bearer token. Never log it. */
export function getLogRoute(url: string): string {
  return new URL(url).pathname.replace(
    /^(\/auth\/reset-password)\/[^/]+\/?$/,
    "$1/:token",
  );
}
