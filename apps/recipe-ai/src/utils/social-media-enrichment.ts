export interface SocialMediaEnrichmentInput {
  caption: string | null;
  pageText?: string | null;
  transcript?: string | null;
  frameText?: string | null;
}

export function buildEnrichedSocialRecipeText(
  input: Pick<SocialMediaEnrichmentInput, "caption" | "pageText"> & {
    transcript?: string | null;
    frameText?: string | null;
  },
): string {
  const parts: string[] = [];

  if (input.caption) {
    parts.push(`Caption:\n${input.caption}`);
  }
  if (input.pageText) {
    parts.push(`Rendered page text:\n${input.pageText}`);
  }
  if (input.transcript) {
    parts.push(`Audio transcript:\n${input.transcript}`);
  }
  if (input.frameText) {
    parts.push(`On-screen text from video frames:\n${input.frameText}`);
  }

  return parts.join("\n\n");
}
