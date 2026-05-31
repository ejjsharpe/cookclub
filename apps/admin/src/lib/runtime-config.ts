const PRODUCTION_API_BASE_URL = "https://api.cookclub.app";
const DEVELOPMENT_API_BASE_URL = "http://localhost:8787";

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

export function getApiBaseUrl() {
  const configured = import.meta.env.VITE_API_BASE_URL;
  if (configured) return trimTrailingSlash(configured);

  return import.meta.env.PROD
    ? PRODUCTION_API_BASE_URL
    : DEVELOPMENT_API_BASE_URL;
}

export function getTrpcUrl() {
  const configured = import.meta.env.VITE_TRPC_URL;
  if (configured) return configured;

  return `${getApiBaseUrl()}/trpc`;
}
