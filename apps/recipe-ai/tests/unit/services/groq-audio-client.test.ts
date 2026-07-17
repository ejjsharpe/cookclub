import { afterEach, describe, expect, it, vi } from "vitest";

import { transcribeGroqAudio } from "../../../src/services/groq-audio-client";

describe("Groq audio client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uploads Instagram audio to Whisper Large V3 Turbo", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ text: " Mix, simmer, and serve. " }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      transcribeGroqAudio({
        apiKey: "groq-key",
        audio: Uint8Array.from([0, 1, 2, 3]),
        prompt: "A cooking recipe",
        language: "en",
      }),
    ).resolves.toBe("Mix, simmer, and serve.");

    const [url, init] = fetchMock.mock.calls[0]!;
    const form = init?.body as FormData;
    expect(url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer groq-key",
    );
    expect(form.get("model")).toBe("whisper-large-v3-turbo");
    expect(form.get("response_format")).toBe("json");
    expect(form.get("prompt")).toBe("A cooking recipe");
    expect(form.get("language")).toBe("en");
    const file = form.get("file");
    expect(file).toBeInstanceOf(Blob);
    expect((file as Blob).type).toBe("audio/mp4");
  });

  it("does not call Groq when its key is missing", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      transcribeGroqAudio({
        apiKey: "",
        audio: new Uint8Array(),
        prompt: "Pasta",
      }),
    ).rejects.toThrow("GROQ_API_KEY is required");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
