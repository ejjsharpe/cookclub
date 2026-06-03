import type {
  Ingredient,
  IngredientSection,
  Instruction,
  InstructionSection,
  ParsedRecipe,
  SourceType,
} from "../schema";
import { parseIngredientText } from "./ingredient-parser";

const UNICODE_FRACTIONS: Record<string, string> = {
  "\u00bc": "1/4",
  "\u00bd": "1/2",
  "\u00be": "3/4",
  "\u2153": "1/3",
  "\u2154": "2/3",
  "\u215b": "1/8",
  "\u215c": "3/8",
  "\u215d": "5/8",
  "\u215e": "7/8",
};
const EMOJI_NUMBER_MARKER = String.raw`[0-9#*]\uFE0F?\u20E3|[\u2460-\u2473\u24EA\u24F5-\u24FF\u2776-\u277F\u2780-\u2793]`;
const NUMBERED_INSTRUCTION_BOUNDARY_PATTERN = new RegExp(
  String.raw`(?:^|\s)(?:(?:step\s*)?\d{1,3}[.)\]:：-]|${EMOJI_NUMBER_MARKER})\s*(?:[.)\]:：-]\s*)?`,
  "giu",
);
const LEADING_INSTRUCTION_MARKER_PATTERN = new RegExp(
  String.raw`^(?:[-*•·▪▫◦\s]+|(?:(?:step\s*)?\d{1,3}[.)\]:：-]|${EMOJI_NUMBER_MARKER})\s*(?:[.)\]:：-]\s*)?)+`,
  "iu",
);

interface RecipeOutlineOptions {
  sourceUrl?: string | null;
  sourceType?: SourceType;
  images?: string[];
}

type OutlineMode = "intro" | "ingredients" | "instructions";

interface SectionAccumulator {
  name: string | null;
  items: string[];
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(
      /([\d\s]?)([\u00bc\u00bd\u00be\u2153\u2154\u215b\u215c\u215d\u215e])/g,
      (_, prefix: string, fraction: string) =>
        `${/\d/.test(prefix) ? `${prefix.trim()} ` : prefix}${UNICODE_FRACTIONS[fraction]}`,
    );
}

function titleCase(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((word) =>
      word.length <= 2
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join(" ");
}

function stripMarkdown(value: string): string {
  return value
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

function stripSocialNoise(value: string): string {
  return normalizeWhitespace(
    value
      .replace(/#[\p{L}\p{N}_-]+/gu, " ")
      .replace(/@\w+/g, " ")
      .replace(
        /\b(?:link in bio|follow for more|save this|share this|comment below|full recipe)\b/gi,
        " ",
      ),
  );
}

function cleanLine(value: string): string {
  return normalizeWhitespace(
    stripMarkdown(value)
      .replace(/^[#>\s]+/, "")
      .replace(/^[-*•·▪▫◦\s]+/, "")
      .replace(/^\p{Extended_Pictographic}+\s*/u, "")
      .trim(),
  );
}

function isBoilerplateLine(line: string): boolean {
  const cleaned = stripSocialNoise(line).toLowerCase();
  if (!cleaned) return true;
  return (
    /^https?:\/\//.test(cleaned) ||
    /^(advertisement|sponsored|comments?|reviews?|nutrition|notes?)$/i.test(
      cleaned,
    ) ||
    /\b(?:subscribe|newsletter|privacy policy|terms of use)\b/i.test(cleaned)
  );
}

function prepareOutlineLines(value: string): string[] {
  const normalized = normalizeText(value)
    .replace(
      /\b(for\s+the\s+[^:\n]{1,80}?\s+you(?:'|')?ll\s+need)\s*:/gi,
      "\n$1:\n",
    )
    .replace(/(^|\n|\.\s+)(you(?:'|')?ll need)\s*:/gi, "$1\n$2:\n")
    .replace(
      /\b(ingredients?|method|directions|instructions|steps)\s*:/gi,
      "\n$1:\n",
    )
    .replace(/\b(serves?\s+\d{1,3}|makes?\s+\d{1,3})\s*:/gi, "\n$1:\n")
    .replace(/[ \t]+([•·▪▫◦*])\s*/g, "\n$1 ")
    .replace(/[ \t]+(?=\d+[.)]\s+)/g, "\n")
    .replace(/[ \t]+[-]\s+(?=[\p{L}\p{N}])/gu, "\n- ");

  return normalized
    .split(/\n+/)
    .map(cleanLine)
    .filter((line) => !isBoilerplateLine(line));
}

function servingsFromText(text: string): number | null {
  const range = text.match(/\bserves?\s+(\d{1,3})\s*(?:-|to)\s*(\d{1,3})/i);
  if (range?.[1] && range[2]) {
    return Math.round((Number(range[1]) + Number(range[2])) / 2);
  }

  const serves = text.match(/\bserves?\s+(\d{1,3})\b/i);
  if (serves?.[1]) return Number(serves[1]);

  const makes = text.match(/\bmakes?\s+(\d{1,3})\b/i);
  return makes?.[1] ? Number(makes[1]) : null;
}

function timeFromText(text: string, label: string): number | null {
  const match = text.match(
    new RegExp(
      `${label}\\s*(?::)?\\s*(?:(\\d+)\\s*(?:hours?|hrs?|hr|h)\\s*)?(?:(\\d+)\\s*(?:minutes?|mins?|min|m))?`,
      "i",
    ),
  );
  if (!match) return null;

  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const total = hours * 60 + minutes;
  return total > 0 ? total : null;
}

function headingNameFromForLine(line: string): string | null {
  const match = line.match(
    /^for\s+the\s+(.+?)(?:\s+you(?:'|')?ll\s+need)?\s*:?\s*$/i,
  );
  if (!match?.[1]) return null;
  return titleCase(
    match[1].replace(/[^\p{L}\p{N}\s'&-]/gu, " ").replace(/\brecipe\b/gi, " "),
  );
}

function isIngredientStart(line: string): boolean {
  return (
    /^ingredients?\s*:?\s*$/i.test(line) ||
    /^you(?:'|')?ll need\s*:?\s*$/i.test(line) ||
    /^(?:serves?|makes?)\s+\d{1,3}\s*:?\s*$/i.test(line)
  );
}

function isInstructionStart(line: string): boolean {
  return /^(?:method|directions|instructions|steps|preparation)\s*:?\s*$/i.test(
    line,
  );
}

function isLikelySectionHeading(line: string): boolean {
  const normalized = line.replace(/:$/, "").trim();
  if (normalized.length > 80) return false;
  if (/^\d/.test(normalized)) return false;
  if (/[,.!?;]$/.test(normalized)) return false;

  const words = normalized.split(/\s+/).filter(Boolean);
  if (/^for\b/i.test(normalized)) return words.length <= 6;
  if (/^to\b/i.test(normalized)) return words.length <= 3;
  if (
    /^make\s+(?:the\s+)?(?:sauce|dough|batter|filling|topping|dressing|garnish)\b/i.test(
      normalized,
    )
  ) {
    return words.length <= 5;
  }

  return /^(?:sauce|filling|topping|dressing|garnish)\b/i.test(normalized)
    ? words.length <= 4
    : false;
}

function isContinuationQuantity(text: string, start: number): boolean {
  const before = text.slice(Math.max(0, start - 16), start);
  const after = text.slice(start, start + 24);
  const multiplierContinuation =
    /\b\d+(?:\s+\d+\/\d+|\/\d+|\.\d+)?\s*x\s+$/i.test(before);
  const eggContinuation =
    /\band\s+$/i.test(before) &&
    /^\d+(?:\s+\d+\/\d+|\/\d+|\.\d+)?\s+egg(?:s|\s+(?:yolk|white))\b/i.test(
      after,
    );

  return (
    /\bplus\s+$/i.test(before) || multiplierContinuation || eggContinuation
  );
}

function quantityStarts(text: string): number[] {
  const starts: number[] = [];
  const pattern =
    /(?:^|[\s,;])(\d+(?:\s+\d+\/\d+|\/\d+|\.\d+)?)(?=\s*(?:[a-zA-Z(]|\d))/g;

  for (const match of text.matchAll(pattern)) {
    const leading = match[0].length - match[1]!.length;
    const start = match.index + leading;
    if (!isContinuationQuantity(text, start)) {
      starts.push(start);
    }
  }

  return [...new Set(starts)].sort((a, b) => a - b);
}

function splitIngredientLine(line: string): string[] {
  const text = stripSocialNoise(line)
    .replace(/^\d+[.)]\s+/, "")
    .replace(/^[*-]\s+/, "")
    .trim();
  if (!text) return [];

  const separatorItems = text
    .split(/\s*[;|]\s*/g)
    .map((item) => item.trim())
    .filter(Boolean);
  if (separatorItems.length >= 2) return separatorItems;

  const starts = quantityStarts(text);
  if (starts.length < 2) return [text];

  const leading = text.slice(0, starts[0]).trim();
  const items = starts.map((start, index) => {
    const end = starts[index + 1] ?? text.length;
    return text
      .slice(start, end)
      .replace(/^[,\s]+/, "")
      .trim();
  });

  if (leading && !/^(?:ingredients?|for the .+|you'll need)$/i.test(leading)) {
    items.unshift(leading);
  }

  return items.filter(Boolean);
}

function splitInstructionLine(line: string): string[] {
  const text = stripSocialNoise(line)
    .replace(LEADING_INSTRUCTION_MARKER_PATTERN, "")
    .trim();
  if (!text) return [];

  const numberedMatches = [
    ...text.matchAll(NUMBERED_INSTRUCTION_BOUNDARY_PATTERN),
  ].filter((match) => match.index != null);
  if (numberedMatches.length >= 2) {
    return numberedMatches
      .map((match, index) => {
        const start = match.index! + match[0].length;
        const end = numberedMatches[index + 1]?.index ?? text.length;
        return text.slice(start, end).trim();
      })
      .filter(Boolean);
  }

  return text
    .split(/(?:\.\s+)(?=[A-Z])/g)
    .map((step) => step.trim())
    .filter(Boolean);
}

function parseIngredientSections(
  sections: SectionAccumulator[],
): IngredientSection[] {
  return sections
    .map((section) => ({
      name: section.name,
      ingredients: section.items
        .flatMap(splitIngredientLine)
        .map(
          (item, index): Ingredient => ({
            index,
            ...parseIngredientText(item),
          }),
        )
        .filter((ingredient) => ingredient.name.length > 0),
    }))
    .filter((section) => section.ingredients.length > 0);
}

function parseInstructionSections(
  sections: SectionAccumulator[],
): InstructionSection[] {
  return sections
    .map((section) => ({
      name: section.name,
      instructions: section.items
        .flatMap(splitInstructionLine)
        .map(
          (instruction, index): Instruction => ({
            index,
            instruction,
            imageUrl: null,
          }),
        )
        .filter((instruction) => instruction.instruction.length > 0),
    }))
    .filter((section) => section.instructions.length > 0);
}

function titleFromUrl(sourceUrl: string | null | undefined): string | null {
  if (!sourceUrl) return null;

  try {
    const slug = new URL(sourceUrl).pathname.split("/").filter(Boolean).at(-1);
    if (!slug) return null;

    const title = slug
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/-\d+$/, "")
      .replace(/-recipe$/i, "")
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
    return title || null;
  } catch {
    return null;
  }
}

function leadingCapsTitle(value: string): string | null {
  const words = stripSocialNoise(value).split(/\s+/).filter(Boolean);
  const titleWords: string[] = [];

  for (const word of words) {
    const letters = word.replace(/[^\p{L}]/gu, "");
    if (!letters) continue;
    if (letters !== letters.toUpperCase()) break;
    titleWords.push(word);
  }

  return titleWords.length > 0 ? titleWords.join(" ") : null;
}

function isSocialActionLine(line: string): boolean {
  const normalized = line
    .replace(/@\w+/g, " ")
    .replace(/#[\p{L}\p{N}_-]+/gu, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (!normalized) return true;

  return (
    /^(?:follow|save|share|comment|like|view|watch|open|sign|log)\b/.test(
      normalized,
    ) ||
    /\b(?:follow for more|link in bio|full recipe below)\b/.test(normalized)
  );
}

function titleFromCapsLine(lines: string[]): string | null {
  for (const line of lines) {
    if (isSocialActionLine(line)) continue;

    const title = leadingCapsTitle(line);
    if (title && title.replace(/[^\p{L}\p{N}]/gu, "").length >= 3) {
      return title;
    }
  }

  return null;
}

function titleFromIntro(lines: string[], sourceUrl: string | null | undefined) {
  const intro = stripSocialNoise(lines.join(" "));
  const source =
    titleFromCapsLine(lines) ??
    leadingCapsTitle(intro) ??
    lines.find((line) => line.length >= 3 && !isSocialActionLine(line));
  const cleaned = stripSocialNoise(source ?? "")
    .replace(/[^\p{L}\p{N}\s'&-]/gu, " ")
    .replace(/\b(recipe|ingredients?|method|directions)\b/gi, " ")
    .trim();

  if (cleaned) return titleCase(cleaned.split(/\s{2,}/)[0] ?? cleaned);
  return titleFromUrl(sourceUrl) ?? "Imported Recipe";
}

function addItem(section: SectionAccumulator, line: string) {
  const cleaned = cleanLine(line);
  if (cleaned) section.items.push(cleaned);
}

export function extractRecipeOutline(
  text: string | null | undefined,
  options: RecipeOutlineOptions = {},
): ParsedRecipe | null {
  if (!text || text.trim().length < 20) return null;

  const lines = prepareOutlineLines(text);
  if (lines.length < 3) return null;

  const introLines: string[] = [];
  const ingredientSectionsRaw: SectionAccumulator[] = [];
  const instructionSectionsRaw: SectionAccumulator[] = [];
  let currentIngredientSection: SectionAccumulator = { name: null, items: [] };
  let currentInstructionSection: SectionAccumulator = {
    name: null,
    items: [],
  };
  let mode: OutlineMode = "intro";
  const allText = normalizeWhitespace(text);
  const servings = servingsFromText(allText);

  const flushIngredientSection = () => {
    if (currentIngredientSection.items.length > 0) {
      ingredientSectionsRaw.push(currentIngredientSection);
    }
  };
  const flushInstructionSection = () => {
    if (currentInstructionSection.items.length > 0) {
      instructionSectionsRaw.push(currentInstructionSection);
    }
  };

  for (const line of lines) {
    const forHeading = headingNameFromForLine(line);

    if (isIngredientStart(line)) {
      if (mode === "ingredients") flushIngredientSection();
      mode = "ingredients";
      currentIngredientSection = { name: null, items: [] };
      continue;
    }

    if (isInstructionStart(line)) {
      if (mode === "ingredients") flushIngredientSection();
      mode = "instructions";
      currentInstructionSection = { name: null, items: [] };
      continue;
    }

    if (forHeading && mode !== "instructions") {
      if (mode === "intro") mode = "ingredients";
      if (mode === "ingredients") flushIngredientSection();
      currentIngredientSection = { name: forHeading, items: [] };
      continue;
    }

    if (mode === "instructions" && isLikelySectionHeading(line)) {
      flushInstructionSection();
      currentInstructionSection = {
        name: titleCase(line.replace(/:$/, "")),
        items: [],
      };
      continue;
    }

    if (mode === "intro") {
      introLines.push(line);
    } else if (mode === "ingredients") {
      addItem(currentIngredientSection, line);
    } else {
      addItem(currentInstructionSection, line);
    }
  }

  if (mode === "ingredients") flushIngredientSection();
  if (mode === "instructions") flushInstructionSection();

  const ingredientSections = parseIngredientSections(ingredientSectionsRaw);
  const instructionSections = parseInstructionSections(instructionSectionsRaw);
  const ingredientCount = ingredientSections.reduce(
    (count, section) => count + section.ingredients.length,
    0,
  );
  const instructionCount = instructionSections.reduce(
    (count, section) => count + section.instructions.length,
    0,
  );

  if (ingredientCount < 2 || instructionCount < 1) return null;

  const prepTime = timeFromText(allText, "prep(?:\\s+time)?");
  const cookTime = timeFromText(allText, "cook(?:\\s+time)?");
  const totalTime =
    timeFromText(allText, "total(?:\\s+time)?") ??
    timeFromText(allText, "ready\\s+in");

  return {
    name: titleFromIntro(introLines, options.sourceUrl),
    description:
      introLines.length > 1
        ? stripSocialNoise(introLines.slice(1).join(" "))
        : null,
    prepTime,
    cookTime,
    totalTime,
    servings,
    sourceUrl: options.sourceUrl ?? null,
    sourceType: options.sourceType ?? (options.sourceUrl ? "url" : "text"),
    ingredientSections,
    instructionSections,
    images: options.images ?? [],
    suggestedTags: [],
  };
}
