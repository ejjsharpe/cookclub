import { providerResponseError, readBoundedJson } from "./provider-response";

const GROQ_TRANSCRIPTIONS_URL =
  "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_TRANSCRIPTION_MODEL = "whisper-large-v3-turbo";
const MAX_TRANSCRIPTION_BYTES = 1024 * 1024;
const MAX_PROMPT_CHARACTERS = 800;

interface TranscriptionOptions {
  apiKey: string;
  audio: Uint8Array;
  prompt: string;
  language?: string;
}

export async function transcribeGroqAudio({
  apiKey,
  audio,
  prompt,
  language,
}: TranscriptionOptions): Promise<string> {
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is required for Groq AI requests.");
  }

  const form = new FormData();
  form.append(
    "file",
    new Blob([Uint8Array.from(audio).buffer], { type: "audio/mp4" }),
    "reel.m4a",
  );
  form.append("model", GROQ_TRANSCRIPTION_MODEL);
  form.append("response_format", "json");
  form.append("prompt", prompt.trim().slice(0, MAX_PROMPT_CHARACTERS));
  if (language) form.append("language", language);

  const response = await fetch(GROQ_TRANSCRIPTIONS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) throw await providerResponseError(response, "Groq");

  const payload = await readBoundedJson(
    response,
    MAX_TRANSCRIPTION_BYTES,
    "Groq",
  );
  const transcript =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>).text
      : null;
  if (typeof transcript !== "string" || !transcript.trim()) {
    throw new Error("Groq returned an empty transcription.");
  }
  return transcript.trim();
}
