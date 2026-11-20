/** "www.bbcgoodfood.com/recipes/…" → "bbcgoodfood.com", for showing where a recipe came from. */
export const sourceHost = (sourceUrl: string | null | undefined) => {
  if (!sourceUrl) return null;
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, "");
  } catch {
    return sourceUrl.replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
  }
};
