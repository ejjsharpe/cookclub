import { vi } from "vitest";

export function createMockDurableObjectStub() {
  return {
    fetch: vi.fn().mockResolvedValue(new Response("OK")),
  };
}

export function createMockDurableObjectNamespace() {
  const stub = createMockDurableObjectStub();
  return {
    idFromName: vi.fn().mockReturnValue({ toString: () => "mock-do-id" }),
    get: vi.fn().mockReturnValue(stub),
    _stub: stub, // Expose for test assertions
  };
}

export function createMockQueue() {
  return {
    send: vi.fn().mockResolvedValue(undefined),
  };
}

export function createMockEnv() {
  return {
    USER_FEED: createMockDurableObjectNamespace(),
    DATABASE_URL: "mock://database",
    GOOGLE_CLIENT_ID: "mock-google-id",
    GOOGLE_CLIENT_SECRET: "mock-google-secret",
    BETTER_AUTH_SECRET: "mock-auth-secret",
    BETTER_AUTH_URL: "http://localhost:8787",
    RECIPE_AI: {
      parse: vi.fn(),
      chat: vi.fn(),
      personalize: vi.fn(),
      generateImage: vi.fn(),
      nutrition: vi.fn(),
    },
    IMAGE_SERVICE: {
      presign: vi.fn(),
      verify: vi.fn(),
      move: vi.fn(),
      delete: vi.fn(),
      uploadFromUrl: vi.fn(),
      uploadImage: vi.fn(),
    },
    IMAGE_PUBLIC_URL: "https://images.example.com",
    RECIPE_IMPORT_BASIC_QUEUE: createMockQueue(),
    RECIPE_IMPORT_URL_QUEUE: createMockQueue(),
    RECIPE_IMPORT_TEXT_QUEUE: createMockQueue(),
    RECIPE_IMPORT_IMAGE_QUEUE: createMockQueue(),
    RESEND_API_KEY: "mock-resend-key",
  };
}
