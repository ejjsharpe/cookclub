import { createContext } from "./context";
import { recipeImportRouter } from "./features/recipe-import/router";
import { activityRouter } from "./routers/activity-router";
import { adminRouter } from "./routers/admin-router";
import { collectionRouter } from "./routers/collection-router";
import { commentRouter } from "./routers/comment-router";
import { followsRouter } from "./routers/follows-router";
import { legalRouter } from "./routers/legal-router";
import { mealPlanRouter } from "./routers/meal-plan-router";
import { moderationRouter } from "./routers/moderation-router";
import { notificationRouter } from "./routers/notification-router";
import { recipeAiRouter, recipeRouter } from "./routers/recipe-router";
import { shoppingRouter } from "./routers/shopping-router";
import { subscriptionRouter } from "./routers/subscription-router";
import { uploadRouter } from "./routers/upload-router";
import { userRouter } from "./routers/user-router";
import { router } from "./trpc";

export { createContext };
export {
  getPublicErrorMessage,
  PublicTRPCError,
  publicCodeForTransport,
  publicErrorForResponse,
} from "./public-errors";
export { processPushNotificationReceipts } from "./services";
export {
  cleanupOrphanedRecipeImportImages,
  cleanupRecipeImportImagesBestEffort,
} from "./features/recipe-import/cleanup";
export {
  failRecipeImportJob,
  processRecipeImportJob,
  recoverStaleRecipeImportJobs,
  RECIPE_IMPORT_PROCESSING_LEASE_MS,
} from "./features/recipe-import/service";
export type {
  RecipeImportFailureEvent,
  ProcessRecipeImportJobResult,
} from "./features/recipe-import/service";
export type Context = Awaited<ReturnType<typeof createContext>>;

export const appRouter = router({
  user: userRouter,
  recipe: recipeRouter,
  recipeAi: recipeAiRouter,
  recipeImport: recipeImportRouter,
  follows: followsRouter,
  collection: collectionRouter,
  shopping: shoppingRouter,
  activity: activityRouter,
  upload: uploadRouter,
  comment: commentRouter,
  mealPlan: mealPlanRouter,
  legal: legalRouter,
  moderation: moderationRouter,
  notification: notificationRouter,
  subscription: subscriptionRouter,
  admin: adminRouter,
});

export type AppRouter = typeof appRouter;
