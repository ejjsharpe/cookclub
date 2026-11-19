// Soft background / ink pairs for people without a photo, from the Colours
// sheet. A name always maps to the same pair.
const PLACEHOLDER_COLOURS = [
  { background: "#F1E4D3", ink: "#6B3E12" }, // sand
  { background: "#DCE8F2", ink: "#1F4B6E" }, // sky
  { background: "#E2F1E8", ink: "#1F6646" }, // sage
  { background: "#F8E3EC", ink: "#8A2352" }, // rose
  { background: "#FFF3C4", ink: "#5C4300" }, // butter
  { background: "#ECE6F7", ink: "#4A3A7A" }, // lavender
] as const;

/** "Priya Shah" → "PS", "james" → "J". */
export function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0]!.charAt(0);
  const last = words.length > 1 ? words[words.length - 1]!.charAt(0) : "";
  return (first + last).toUpperCase();
}

export function getPlaceholderColours(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return PLACEHOLDER_COLOURS[Math.abs(hash) % PLACEHOLDER_COLOURS.length]!;
}
