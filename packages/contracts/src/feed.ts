import type { PublicImageAsset } from "./images";

export type FeedSourceType =
  "url" | "image" | "text" | "ai" | "manual" | "user";

export type PublicSubscriptionTier = "free" | "pro";

interface BaseRecipeMetadata {
  id: number;
  ownerId: string;
  name: string;
  image: PublicImageAsset | null;
  /** Total time in minutes (or prep + cook when total isn't set). */
  totalTime?: number | null;
  /** Up to two of the owner's tags, for the card's meta line. */
  tags?: string[];
}

interface UrlSourcedRecipe extends BaseRecipeMetadata {
  sourceType: "url";
  sourceUrl: string;
  sourceDomain: string;
}

interface UserSourcedRecipe extends BaseRecipeMetadata {
  sourceType: "user";
  originalOwner: {
    id: string;
    name: string;
    username: string | null;
    image: string | null;
  } | null;
}

interface AppSourcedRecipe extends BaseRecipeMetadata {
  sourceType: Exclude<FeedSourceType, "url" | "user">;
}

export type RecipeMetadata =
  UrlSourcedRecipe | UserSourcedRecipe | AppSourcedRecipe;

interface Actor {
  id: string;
  name: string;
  username: string | null;
  image: string | null;
  subscriptionTier: PublicSubscriptionTier;
}

interface BaseFeedItem {
  id: string;
  actor: Actor;
  createdAt: number;
  likeCount: number;
  commentCount: number;
  isLiked: boolean;
}

export interface RecipeImportFeedItem extends BaseFeedItem {
  type: "recipe_import";
  recipe: RecipeMetadata;
}

export interface CookingReviewFeedItem extends BaseFeedItem {
  type: "cooking_review";
  recipe: RecipeMetadata;
  review: {
    rating: number;
    text: string | null;
    images: PublicImageAsset[];
  };
}

export type FeedItem = RecipeImportFeedItem | CookingReviewFeedItem;

export interface GetFeedResponse {
  items: FeedItem[];
  nextCursor: string | null;
}

export interface DurableObjectId {
  toString(): string;
}

export interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
}

export interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

export interface ActivityServiceEnv {
  USER_FEED: DurableObjectNamespace;
}
