import type { ParsedRecipeNutrition } from "@repo/contracts/recipe";
import { type } from "arktype";

export const IngredientSchema = type({
  index: "number >= 0",
  "quantity?": "number | null",
  "unit?": "string | null",
  name: "string",
});

export const InstructionSchema = type({
  index: "number >= 0",
  instruction: "string",
  "imageUrl?": "string | null",
});

const IngredientSectionSchema = type({
  name: "string | null",
  ingredients: IngredientSchema.array(),
});

const InstructionSectionSchema = type({
  name: "string | null",
  instructions: InstructionSchema.array(),
});

const SourceTypeSchema = type("'url' | 'image' | 'text' | 'ai' | 'manual'");

export const ParsedRecipeSchema = type({
  name: "string",
  "description?": "string | null",
  "prepTime?": "number | null", // minutes
  "cookTime?": "number | null", // minutes
  "totalTime?": "number | null", // minutes
  "servings?": "number | null",
  "sourceUrl?": "string | null",
  "sourceType?": SourceTypeSchema,
  ingredientSections: IngredientSectionSchema.array().atLeastLength(1),
  instructionSections: InstructionSectionSchema.array(),
  "images?": "string[]",
  "suggestedTags?": "string[]",
  "nutrition?": "object | null",
});

export type ParsedRecipe = typeof ParsedRecipeSchema.infer;
export type Ingredient = typeof IngredientSchema.infer;
export type Instruction = typeof InstructionSchema.infer;
export type IngredientSection = typeof IngredientSectionSchema.infer;
export type InstructionSection = typeof InstructionSectionSchema.infer;
export type Tag = string;
export type SourceType = typeof SourceTypeSchema.infer;
export type Nutrition = ParsedRecipeNutrition;
