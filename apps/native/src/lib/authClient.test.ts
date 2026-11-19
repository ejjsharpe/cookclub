import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAuthClient: vi.fn(),
  expoClient: vi.fn(),
  getActions: vi.fn(),
}));

vi.mock("@better-auth/expo/client", () => ({
  expoClient: mocks.expoClient,
}));

vi.mock("better-auth/react", () => ({
  createAuthClient: mocks.createAuthClient,
}));

vi.mock("./mmkv", () => ({
  storage: {
    getString: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock("./runtimeConfig", () => ({
  getAuthBaseUrl: vi.fn(() => "https://api.cookclub.app"),
}));

describe("authClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("gets cookies from the initialized auth client", async () => {
    const plugin = { id: "expo", getActions: mocks.getActions };
    const clientGetCookie = vi.fn(async () => "session=cookie");
    mocks.expoClient.mockReturnValue(plugin);
    mocks.createAuthClient.mockReturnValue({ getCookie: clientGetCookie });

    const { getAuthCookie } = await import("./authClient");

    expect(mocks.createAuthClient).toHaveBeenCalledWith(
      expect.objectContaining({ plugins: [plugin] }),
    );
    expect(mocks.getActions).not.toHaveBeenCalled();
    await expect(getAuthCookie()).resolves.toBe("session=cookie");
    expect(clientGetCookie).toHaveBeenCalledOnce();
  });
});
