import { useSyncExternalStore } from "react";

// Development only: shows onboarding to an account that has already finished
// it, without saving the profile, so the flow can be checked without
// creating (and verifying) a new account each time.
let previewing = false;
const listeners = new Set<() => void>();

export function setOnboardingPreview(next: boolean): void {
  if (!__DEV__ || previewing === next) return;
  previewing = next;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useOnboardingPreview(): boolean {
  return useSyncExternalStore(subscribe, () => previewing);
}
