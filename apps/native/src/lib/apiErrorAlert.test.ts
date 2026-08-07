import { describe, expect, it, vi } from "vitest";

import { alertApiError } from "./apiErrorAlert";

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  isReady: vi.fn(() => true),
  navigate: vi.fn(),
  openExternalWebsite: vi.fn(),
}));

vi.mock("@sentry/react-native", () => ({
  captureException: vi.fn(),
  withScope: vi.fn(),
}));

vi.mock("react-native", () => ({
  Alert: { alert: mocks.alert },
}));

vi.mock("./externalBrowser", () => ({
  openExternalWebsite: mocks.openExternalWebsite,
}));

vi.mock("@/navigation/navigationRef", () => ({
  navigationRef: {
    isReady: mocks.isReady,
    navigate: mocks.navigate,
  },
}));

describe("alertApiError", () => {
  it("offers terms and Settings actions when acceptance is required", () => {
    alertApiError(
      "Couldn’t Publish",
      { data: { appCode: "TERMS_ACCEPTANCE_REQUIRED" } },
      { operation: "comment.create", fallback: "Could not publish." },
    );

    expect(mocks.alert).toHaveBeenCalledWith(
      "Terms acceptance required",
      expect.stringContaining("Settings"),
      expect.arrayContaining([
        expect.objectContaining({ text: "Read Terms" }),
        expect.objectContaining({ text: "Open Settings" }),
      ]),
    );
  });
});
