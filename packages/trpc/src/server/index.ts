import { createContext } from "./context";
import { activityRouter } from "./routers/activity-router";
import { adminRouter } from "./routers/admin-router";
import { collectionRouter } from "./routers/collection-router";
import { commentRouter } from "./routers/comment-router";
import { followsRouter } from "./routers/follows-router";
import { mealPlanRouter } from "./routers/meal-plan-router";
import { notificationRouter } from "./routers/notification-router";
import { recipeRouter } from "./routers/recipe-router";
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
export {
  failRecipeImportJob,
  processPushNotificationReceipts,
  processRecipeImportJob,
  RECIPE_IMPORT_PROCESSING_LEASE_MS,
} from "./services";
export type { RecipeImportFailureEvent } from "./services";
export type Context = Awaited<ReturnType<typeof createContext>>;

export const appRouter = router({
  user: userRouter,
  recipe: recipeRouter,
  follows: followsRouter,
  collection: collectionRouter,
  shopping: shoppingRouter,
  activity: activityRouter,
  upload: uploadRouter,
  comment: commentRouter,
  mealPlan: mealPlanRouter,
  notification: notificationRouter,
  subscription: subscriptionRouter,
  admin: adminRouter,
});

export type AppRouter = typeof appRouter;
