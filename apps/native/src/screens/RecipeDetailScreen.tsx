import {
  StackActions,
  useRoute,
  useNavigation,
  type RouteProp,
} from "@react-navigation/native";
import type {
  NativeStackHeaderItem,
  NativeStackHeaderItemProps,
} from "@react-navigation/native-stack";
import type { PublicImageAsset } from "@repo/contracts/images";
import { useTRPC } from "@repo/trpc/client";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  useLayoutEffect,
} from "react";
import {
  View,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
  Modal,
  Alert,
  FlatList,
  Keyboard,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Platform,
  Pressable,
  TextInput,
} from "react-native";
import {
  KeyboardAwareScrollView,
  type KeyboardAwareScrollViewRef,
} from "react-native-keyboard-controller";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  interpolate,
  Extrapolation,
  useAnimatedScrollHandler,
  FadeIn,
  FadeOut,
  LinearTransition,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";

import { useCreateCookingReview } from "@/api/activity";
import { useBlockUser } from "@/api/moderation";
import {
  useRecipeDetail,
  useCompleteRecipeImport,
  useImportRecipe,
  useDeleteRecipe,
  useGenerateRecipeImage,
  useGetRecipeNutrition,
  usePersonalizeRecipe,
  useSaveRecipe,
  useUpdateRecipe,
  type ParsedRecipe,
  type Recipe,
} from "@/api/recipe";
import { useUser } from "@/api/user";
import {
  AdjustRecipeSheet,
  type AdjustRecipeSheetRef,
} from "@/components/AdjustRecipeSheet";
import { AutocompleteTagSelector } from "@/components/AutocompleteTagSelector";
import {
  CollectionSelectorSheet,
  type CollectionSelectorSheetRef,
} from "@/components/CollectionSelectorSheet";
import {
  CookingReviewSheet,
  type CookingReviewSheetRef,
} from "@/components/CookingReviewSheet";
import { Ionicons } from "@/components/Ionicons";
import { OptimizedImage } from "@/components/OptimizedImage";
import { PageIndicator } from "@/components/PageIndicator";
import {
  PersonaliseRecipeSheet,
  type PersonaliseRecipeSheetRef,
} from "@/components/PersonaliseRecipeSheet";
import {
  RecipePhotosSheet,
  type RecipePhotoItem,
  type RecipePhotosSheetRef,
} from "@/components/RecipePhotosSheet";
import {
  ReportContentSheet,
  type ReportContentSheetRef,
} from "@/components/ReportContentSheet";
import {
  ShoppingListSelectorSheet,
  type ShoppingListSelectorSheetRef,
} from "@/components/ShoppingListSelectorSheet";
import { Skeleton } from "@/components/Skeleton";
import { VSpace } from "@/components/Space";
import { SystemIcon } from "@/components/SystemIcon";
import { Text } from "@/components/Text";
import { PrimaryButton } from "@/components/buttons/PrimaryButton";
import { CommentOptionsMenu } from "@/components/comment-options/CommentOptionsMenu";
import type { CommentOption } from "@/components/comment-options/types";
import {
  GlassButtonGroup,
  GlassIconButton,
  GlassSurface,
} from "@/components/glass/Glass";
import {
  AddToMealPlanSheet,
  type AddToMealPlanSheetRef,
} from "@/components/mealPlan/AddToMealPlanSheet";
import { useRecipeImport } from "@/features/recipe-import/RecipeImportProvider";
import { useImageUpload } from "@/hooks/useImageUpload";
import { alertApiError } from "@/lib/apiErrorAlert";
import { openExternalWebsite } from "@/lib/externalBrowser";
import type { MeasurementSystem } from "@/lib/measurementPreferences";
import { publicErrorDetails, resolvePublicError } from "@/lib/publicError";
import {
  getRecipeDraftValidationErrors,
  type RecipeDraftValidationField,
} from "@/lib/recipeDraftValidation";
import { useSubscription } from "@/lib/subscription";
import type { RootStackParamList } from "@/navigation/navigationRef";
import {
  ensureCameraPermission,
  ensureMediaLibraryPermission,
} from "@/utils/imagePickerPermissions";
import { getImageUrl, selectDetailImagePreset } from "@/utils/imageUrl";
import {
  isCompactUnit,
  formatUnit,
  convertParsedIngredient,
} from "@/utils/measurementUtils";
import { transformParsedRecipeForPreview } from "@/utils/recipeTransform";
import { formatMinutesShort } from "@/utils/timeUtils";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const IMAGE_HEIGHT = SCREEN_WIDTH;
// Where each photo sits in the fanned stack on the edit-mode photo pill.
const STACK_POSES = [
  { left: 0, transform: [{ rotate: "-8deg" }] },
  { left: 12, transform: [{ rotate: "-2deg" }] },
  { left: 24, transform: [{ rotate: "8deg" }] },
] as const;

type RecipeDetailMode = "view" | "edit";

type RecipeDetailScreenRoute = RouteProp<RootStackParamList, "RecipeDetail">;

type SourceType = "url" | "image" | "text" | "ai" | "manual" | "user";

type RecipeLike =
  Recipe | NonNullable<ReturnType<typeof transformParsedRecipeForPreview>>;

interface RecipeImage {
  id: number;
  url: string;
  storageKey?: string;
  width?: number;
  height?: number;
  contentType?: string;
  byteSize?: number;
  thumbhash?: string;
}

function recipeImageToSource(image: RecipeImage): PublicImageAsset | string {
  return image.storageKey &&
    image.width &&
    image.height &&
    image.contentType &&
    image.byteSize !== undefined &&
    image.thumbhash !== undefined
    ? {
        url: image.url,
        storageKey: image.storageKey,
        width: image.width,
        height: image.height,
        contentType: image.contentType as PublicImageAsset["contentType"],
        byteSize: image.byteSize,
        thumbhash: image.thumbhash,
      }
    : image.url;
}

interface DraftImage {
  id: string;
  uri: string;
  isRemote: boolean;
  asset?: PublicImageAsset;
  uploadKey?: string;
}

interface DraftIngredient {
  id: string;
  text: string;
}

interface DraftIngredientSection {
  id: string;
  name: string;
  ingredients: DraftIngredient[];
}

interface DraftInstruction {
  id: string;
  instruction: string;
  imageUrl: string | null;
}

interface DraftInstructionSection {
  id: string;
  name: string;
  instructions: DraftInstruction[];
}

interface RecipeDraft {
  name: string;
  description: string;
  prepTime: number | null;
  cookTime: number | null;
  totalTime: number | null;
  servings: number;
  sourceUrl?: string;
  sourceType: SourceType;
  tagNames: string[];
  nutrition?: Recipe["nutrition"];
  images: DraftImage[];
  ingredientSections: DraftIngredientSection[];
  instructionSections: DraftInstructionSection[];
}

function isPreviewParams(
  params: RootStackParamList["RecipeDetail"],
): params is {
  parsedRecipe: ParsedRecipe;
  mode?: RecipeDetailMode;
  generatedImage?: {
    publicUrl: string;
    imageUploadId: string;
  };
} {
  return "parsedRecipe" in params;
}

function isImportReviewParams(
  params: RootStackParamList["RecipeDetail"],
): params is { importJobId: string; mode?: RecipeDetailMode } {
  return "importJobId" in params;
}

function isBlankDraftParams(
  params: RootStackParamList["RecipeDetail"],
): params is { draft: true; mode: "edit" } {
  return "draft" in params;
}

function createDraftId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function ingredientToText(ingredient: {
  quantity?: string | number | null;
  unit?: string | null;
  name?: string | null;
  preparation?: string | null;
}) {
  const text = [ingredient.quantity, ingredient.unit, ingredient.name]
    .filter(Boolean)
    .join(" ")
    .trim();

  return ingredient.preparation ? `${text}, ${ingredient.preparation}` : text;
}

function draftFromRecipe(recipe: RecipeLike): RecipeDraft {
  return {
    name: recipe.name ?? "",
    description: recipe.description ?? "",
    prepTime: recipe.prepTime ?? null,
    cookTime: recipe.cookTime ?? null,
    totalTime: recipe.totalTime ?? null,
    servings: recipe.servings ?? 4,
    sourceUrl: recipe.sourceUrl ?? undefined,
    sourceType: (recipe.sourceType ?? "manual") as SourceType,
    tagNames: (recipe.tags ?? []).map((tag) => tag.name),
    nutrition: recipe.nutrition ?? undefined,
    images: (recipe.images ?? []).map((image, index) => ({
      id: `remote-${image.id ?? index}`,
      uri: image.url,
      isRemote: true,
      ...("storageKey" in image && { asset: image }),
    })),
    ingredientSections:
      recipe.ingredientSections.length > 0
        ? recipe.ingredientSections.map((section, sectionIndex) => ({
            id: `ingredient-section-${section.id ?? sectionIndex}`,
            name: section.name ?? "",
            ingredients:
              section.ingredients.length > 0
                ? section.ingredients.map((ingredient, ingredientIndex) => ({
                    id: `ingredient-${ingredient.id ?? `${sectionIndex}-${ingredientIndex}`}`,
                    text: ingredientToText(ingredient),
                  }))
                : [{ id: createDraftId("ingredient"), text: "" }],
          }))
        : [
            {
              id: createDraftId("ingredient-section"),
              name: "",
              ingredients: [{ id: createDraftId("ingredient"), text: "" }],
            },
          ],
    instructionSections:
      recipe.instructionSections.length > 0
        ? recipe.instructionSections.map((section, sectionIndex) => ({
            id: `instruction-section-${section.id ?? sectionIndex}`,
            name: section.name ?? "",
            instructions:
              section.instructions.length > 0
                ? section.instructions.map((instruction, instructionIndex) => ({
                    id: `instruction-${instruction.id ?? `${sectionIndex}-${instructionIndex}`}`,
                    instruction: instruction.instruction,
                    imageUrl: instruction.imageUrl ?? null,
                  }))
                : [
                    {
                      id: createDraftId("instruction"),
                      instruction: "",
                      imageUrl: null,
                    },
                  ],
          }))
        : [
            {
              id: createDraftId("instruction-section"),
              name: "",
              instructions: [
                {
                  id: createDraftId("instruction"),
                  instruction: "",
                  imageUrl: null,
                },
              ],
            },
          ],
  };
}

function draftFromParsedRecipe(
  parsedRecipe: ParsedRecipe,
  generatedImage?: { publicUrl: string; imageUploadId: string },
): RecipeDraft | null {
  const previewRecipe = transformParsedRecipeForPreview(parsedRecipe);
  if (!previewRecipe) return null;

  const draft = draftFromRecipe(previewRecipe);
  if (!generatedImage) return draft;

  return {
    ...draft,
    images: [
      {
        id: createDraftId("generated-image"),
        uri: generatedImage.publicUrl,
        isRemote: false,
        uploadKey: generatedImage.imageUploadId,
      },
      ...draft.images,
    ],
  };
}

function createBlankDraft(): RecipeDraft {
  return {
    name: "",
    description: "",
    prepTime: null,
    cookTime: null,
    totalTime: null,
    servings: 4,
    sourceType: "manual",
    tagNames: [],
    images: [],
    ingredientSections: [
      {
        id: createDraftId("ingredient-section"),
        name: "",
        ingredients: [{ id: createDraftId("ingredient"), text: "" }],
      },
    ],
    instructionSections: [
      {
        id: createDraftId("instruction-section"),
        name: "",
        instructions: [
          {
            id: createDraftId("instruction"),
            instruction: "",
            imageUrl: null,
          },
        ],
      },
    ],
  };
}

function nutritionForMutation(nutrition: RecipeDraft["nutrition"]) {
  if (!nutrition) return undefined;

  const { generatedAt: _generatedAt, ...mutationNutrition } = nutrition;
  return mutationNutrition;
}

function draftToMutationInput(draft: RecipeDraft) {
  const remoteImages = draft.images
    .filter((image) => image.isRemote)
    .map((image) => image.asset ?? { url: image.uri });
  const imageUploadIds = draft.images
    .filter((image) => !image.isRemote && image.uploadKey)
    .map((image) => image.uploadKey!);
  let imageIndex = 0;
  let uploadIndex = 0;
  const imageOrder = draft.images.map((image) =>
    image.isRemote
      ? { source: "image" as const, index: imageIndex++ }
      : { source: "upload" as const, index: uploadIndex++ },
  );
  const nutrition = nutritionForMutation(draft.nutrition);

  return {
    name: draft.name.trim(),
    description: draft.description.trim() || undefined,
    prepTime: draft.prepTime ?? undefined,
    cookTime: draft.cookTime ?? undefined,
    totalTime: draft.totalTime ?? undefined,
    servings: Math.max(1, draft.servings),
    tagNames: draft.tagNames,
    ingredientSections: draft.ingredientSections
      .map((section) => ({
        name: section.name.trim() || null,
        ingredients: section.ingredients
          .filter((ingredient) => ingredient.text.trim())
          .map((ingredient, index) => ({
            index,
            ingredient: ingredient.text.trim(),
          })),
      }))
      .filter((section) => section.ingredients.length > 0),
    instructionSections: draft.instructionSections
      .map((section) => ({
        name: section.name.trim() || null,
        instructions: section.instructions
          .filter((instruction) => instruction.instruction.trim())
          .map((instruction, index) => ({
            index,
            instruction: instruction.instruction.trim(),
            imageUrl: instruction.imageUrl,
          })),
      }))
      .filter((section) => section.instructions.length > 0),
    ...(remoteImages.length > 0 && { images: remoteImages }),
    ...(imageUploadIds.length > 0 && { imageUploadIds }),
    ...(imageOrder.length > 0 && { imageOrder }),
    ...(draft.sourceUrl && { sourceUrl: draft.sourceUrl }),
    sourceType: draft.sourceType,
    ...(nutrition && { nutrition }),
  };
}

function getSourceWebsiteName(sourceUrl: string | null | undefined) {
  if (!sourceUrl) return null;

  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export const RecipeDetailScreen = () => {
  const route = useRoute<RecipeDetailScreenRoute>();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const params = route.params;
  const trpc = useTRPC();

  const isParsedPreviewMode = isPreviewParams(params);
  const isImportReviewMode = isImportReviewParams(params);
  const isPreviewMode = isParsedPreviewMode || isImportReviewMode;
  const isBlankDraftMode = isBlankDraftParams(params);
  const importJobId = isImportReviewMode ? params.importJobId : undefined;
  const generatedImage = isParsedPreviewMode
    ? params.generatedImage
    : undefined;
  const recipeId = "recipeId" in params ? params.recipeId : null;
  const shouldStartEditing =
    params.mode === "edit" || isBlankDraftMode || isPreviewMode;
  const isCreateMode = isPreviewMode || isBlankDraftMode;

  const {
    data: fetchedRecipe,
    isPending: isRecipePending,
    error: recipeError,
  } = useRecipeDetail({ recipeId });
  const importDetailQuery = useQuery({
    ...trpc.recipeImport.get.queryOptions({
      id: importJobId ?? "00000000-0000-4000-8000-000000000000",
    }),
    enabled: isImportReviewMode,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "pending" || status === "processing" ? 2500 : false;
    },
  });
  const parsedRecipe = isParsedPreviewMode
    ? params.parsedRecipe
    : importDetailQuery.data?.recipe?.success
      ? importDetailQuery.data.recipe
      : null;
  const importFailure =
    importDetailQuery.data?.status === "failed"
      ? {
          data: {
            appCode:
              importDetailQuery.data.errorCode ?? "IMPORT_RECIPE_NOT_FOUND",
          },
        }
      : null;
  const error = recipeError ?? importDetailQuery.error ?? importFailure;
  const isPending =
    (recipeId !== null && isRecipePending) ||
    (isImportReviewMode &&
      (importDetailQuery.isPending ||
        importDetailQuery.data?.status === "pending" ||
        importDetailQuery.data?.status === "processing"));

  const previewRecipe = useMemo(() => {
    if (isPreviewMode && parsedRecipe) {
      return transformParsedRecipeForPreview(parsedRecipe);
    }
    return null;
  }, [isPreviewMode, parsedRecipe]);

  const recipe = isPreviewMode ? previewRecipe : fetchedRecipe;

  const { data: userData } = useUser();

  const saveRecipeMutation = useSaveRecipe();
  const completeImportMutation = useCompleteRecipeImport();
  const updateRecipeMutation = useUpdateRecipe();
  const importMutation = useImportRecipe();
  const deleteMutation = useDeleteRecipe();
  const personalizeRecipeMutation = usePersonalizeRecipe();
  const generateRecipeImageMutation = useGenerateRecipeImage();
  const nutritionMutation = useGetRecipeNutrition();
  const createCookingReviewMutation = useCreateCookingReview();
  const blockUserMutation = useBlockUser();
  const { isPro, requireProFeature, presentPaywall } = useSubscription();
  const { dismissImport } = useRecipeImport();

  const [servings, setServings] = useState(1);
  const [measurementSystem, setMeasurementSystem] = useState<MeasurementSystem>(
    (userData?.user?.measurementPreference as MeasurementSystem) ?? "auto",
  );
  const [isEditing, setIsEditing] = useState(shouldStartEditing);
  const [draft, setDraft] = useState<RecipeDraft | null>(() => {
    if (isBlankDraftMode) return createBlankDraft();
    if (parsedRecipe)
      return draftFromParsedRecipe(parsedRecipe, generatedImage);
    return null;
  });
  const [hasAttemptedSave, setHasAttemptedSave] = useState(false);
  const [editFooterHeight, setEditFooterHeight] = useState(0);
  const initialDraftRef = useRef<RecipeDraft | null>(draft);
  const draftSourceRef = useRef<string | null>(null);
  const hasInitializedServings = useRef(false);
  const draftImageListRef = useRef<FlatList<DraftImage>>(null);
  const pendingImageScrollIndexRef = useRef<number | null>(null);
  const pendingImageScrollAnimatedRef = useRef(true);
  const nutritionRequestRecipeIdRef = useRef<number | null>(null);
  const isDismissingImportRef = useRef(false);
  const adjustRecipeSheetRef = useRef<AdjustRecipeSheetRef>(null);
  const personaliseRecipeSheetRef = useRef<PersonaliseRecipeSheetRef>(null);
  const addToMealPlanSheetRef = useRef<AddToMealPlanSheetRef>(null);
  const shoppingListSheetRef = useRef<ShoppingListSelectorSheetRef>(null);
  const collectionSheetRef = useRef<CollectionSelectorSheetRef>(null);
  const cookingReviewSheetRef = useRef<CookingReviewSheetRef>(null);
  const reportSheetRef = useRef<ReportContentSheetRef>(null);
  const recipePhotosSheetRef = useRef<RecipePhotosSheetRef>(null);
  const ingredientSectionYRef = useRef(0);
  const summaryPanelYRef = useRef(0);
  const [expandedImageUrl, setExpandedImageUrl] = useState<string | null>(null);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [ratingOverride, setRatingOverride] = useState<number | null>(null);
  const [nutrition, setNutrition] = useState<Recipe["nutrition"] | null>(null);

  const {
    uploadImages,
    isUploading: isUploadingImages,
    uploadProgress,
  } = useImageUpload({
    onError: (uploadError) => {
      alertApiError("Upload Error", uploadError, {
        operation: "image.upload",
        fallback: "Failed to upload the image. Please try again.",
      });
    },
  });

  const scrollRef = useRef<KeyboardAwareScrollViewRef>(null);
  const ensureFocusedInputVisible = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.assureFocusedInputVisible();
    });
  }, []);
  const scrollY = useSharedValue(0);

  useEffect(() => {
    if (!isEditing) return;

    const keyboardDidShow = Keyboard.addListener(
      "keyboardDidShow",
      ensureFocusedInputVisible,
    );
    return () => keyboardDidShow.remove();
  }, [ensureFocusedInputVisible, isEditing]);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.set(event.contentOffset.y);
    },
  });

  const imageAnimatedStyle = useAnimatedStyle(() => {
    const scale = interpolate(scrollY.get(), [-200, 0], [2, 1], {
      extrapolateLeft: Extrapolation.EXTEND,
      extrapolateRight: Extrapolation.CLAMP,
    });
    const scaleCompensation = -(IMAGE_HEIGHT * (scale - 1)) / 2;
    const parallax = scrollY.get() > 0 ? scrollY.get() / 2 : 0;

    return {
      transform: [{ translateY: scaleCompensation + parallax }, { scale }],
    };
  });

  const sourceKey = isBlankDraftMode
    ? `blank-${route.key}`
    : isPreviewMode
      ? `parsed-${route.key}`
      : recipeId
        ? `recipe-${recipeId}`
        : null;

  useEffect(() => {
    setIsEditing(shouldStartEditing);
  }, [shouldStartEditing, sourceKey]);

  useEffect(() => {
    if (!sourceKey || draftSourceRef.current === sourceKey) return;

    let nextDraft: RecipeDraft | null = null;
    if (isBlankDraftMode) {
      nextDraft = createBlankDraft();
    } else if (parsedRecipe) {
      nextDraft = draftFromParsedRecipe(parsedRecipe, generatedImage);
    } else if (fetchedRecipe) {
      nextDraft = draftFromRecipe(fetchedRecipe);
    }

    if (!nextDraft) return;

    setDraft(nextDraft);
    setHasAttemptedSave(false);
    initialDraftRef.current = nextDraft;
    draftSourceRef.current = sourceKey;
    setCurrentImageIndex(0);
  }, [
    fetchedRecipe,
    generatedImage,
    isBlankDraftMode,
    parsedRecipe,
    sourceKey,
  ]);

  useEffect(() => {
    if (recipe?.servings && !hasInitializedServings.current) {
      setServings(recipe.servings);
      hasInitializedServings.current = true;
    }
  }, [recipe?.servings]);

  useEffect(() => {
    setRatingOverride(null);
    hasInitializedServings.current = false;
    setNutrition(null);
    nutritionRequestRecipeIdRef.current = null;
  }, [recipeId]);

  useEffect(() => {
    setNutrition(recipe?.nutrition ?? null);
  }, [recipe?.id, recipe?.nutrition]);

  useEffect(() => {
    if (
      !isPro ||
      isEditing ||
      isPreviewMode ||
      !recipe ||
      recipe.id < 0 ||
      nutrition ||
      nutritionMutation.isPending ||
      nutritionRequestRecipeIdRef.current === recipe.id
    ) {
      return;
    }

    nutritionRequestRecipeIdRef.current = recipe.id;
    nutritionMutation.mutate(
      { recipeId: recipe.id },
      {
        onSuccess: (data) => setNutrition(data),
      },
    );
  }, [isEditing, isPreviewMode, isPro, nutrition, nutritionMutation, recipe]);

  useEffect(() => {
    const imageCount = isEditing
      ? (draft?.images.length ?? 0)
      : (recipe?.images.length ?? 0);
    if (imageCount > 0 && currentImageIndex > imageCount - 1) {
      setCurrentImageIndex(imageCount - 1);
    }
  }, [
    currentImageIndex,
    draft?.images.length,
    isEditing,
    recipe?.images.length,
  ]);

  useEffect(() => {
    const index = pendingImageScrollIndexRef.current;
    if (
      !isEditing ||
      !draft ||
      index === null ||
      draft.images.length <= index
    ) {
      return;
    }

    pendingImageScrollIndexRef.current = null;
    const animated = pendingImageScrollAnimatedRef.current;
    pendingImageScrollAnimatedRef.current = true;
    setCurrentImageIndex(index);
    requestAnimationFrame(() => {
      draftImageListRef.current?.scrollToIndex({
        index,
        animated,
      });
    });
  }, [draft, isEditing]);

  const isOwnRecipe = Boolean(
    recipe && userData?.user?.id && recipe.owner.id === userData.user.id,
  );
  const displayedRating = ratingOverride ?? recipe?.userReviewRating ?? null;
  const recipeSourceUrl = recipe?.sourceUrl ?? null;
  const sourceWebsiteName = useMemo(
    () => getSourceWebsiteName(recipeSourceUrl),
    [recipeSourceUrl],
  );
  const sourceChipAccessibilityLabel = sourceWebsiteName
    ? `View on ${sourceWebsiteName}`
    : undefined;
  const ownerAvatarUrl = recipe?.owner.image
    ? getImageUrl(recipe.owner.image, "avatar-sm")
    : undefined;
  const ownerUsername = recipe?.owner.username
    ? `@${recipe.owner.username}`
    : recipe?.owner.name;
  const servingMultiplier = recipe?.servings ? servings / recipe.servings : 1;
  const shoppingListIngredientSections = useMemo(
    () =>
      recipe
        ? recipe.ingredientSections.map((section) => ({
            id: section.id,
            name: section.name,
            ingredients: section.ingredients.map((ing) => ({
              id: ing.id,
              quantity: ing.quantity
                ? (parseFloat(ing.quantity) * servingMultiplier).toString()
                : null,
              unit: ing.unit,
              name: ing.name,
              preparation: ing.preparation,
            })),
          }))
        : [],
    [recipe, servingMultiplier],
  );
  const shoppingListIngredients = useMemo(
    () =>
      shoppingListIngredientSections.flatMap((section) => section.ingredients),
    [shoppingListIngredientSections],
  );
  const isSaving =
    saveRecipeMutation.isPending ||
    completeImportMutation.isPending ||
    updateRecipeMutation.isPending ||
    isUploadingImages ||
    generateRecipeImageMutation.isPending;
  const draftErrors = useMemo(
    () => (draft ? getRecipeDraftValidationErrors(draft) : []),
    [draft],
  );
  const visibleDraftErrors = hasAttemptedSave ? draftErrors : [];
  const hasVisibleDraftError = useCallback(
    (field: RecipeDraftValidationField) =>
      visibleDraftErrors.some((error) => error.field === field),
    [visibleDraftErrors],
  );
  const validationSummary = visibleDraftErrors
    .map((error) => error.message)
    .join(" ");
  const scrollToDraftError = useCallback(
    (field: RecipeDraftValidationField) => {
      const targetY =
        field === "ingredients"
          ? IMAGE_HEIGHT + ingredientSectionYRef.current - 24
          : field === "name" || field === "servings"
            ? IMAGE_HEIGHT + summaryPanelYRef.current - 24
            : 0;

      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({
          y: Math.max(0, targetY),
          animated: true,
        });
      });
    },
    [scrollRef],
  );
  const updateDraft = useCallback(
    (updater: (current: RecipeDraft) => RecipeDraft) => {
      setDraft((current) => (current ? updater(current) : current));
    },
    [],
  );

  const handleEnterEditMode = useCallback(() => {
    if (!recipe) return;
    const nextDraft = draftFromRecipe(recipe);
    setDraft(nextDraft);
    initialDraftRef.current = nextDraft;
    setHasAttemptedSave(false);
    // The edit carousel mounts at the first photo.
    setCurrentImageIndex(0);
    setIsEditing(true);
  }, [recipe]);

  const handleImageScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetX = event.nativeEvent.contentOffset.x;
      const newIndex = Math.round(offsetX / SCREEN_WIDTH);
      if (newIndex !== currentImageIndex) {
        setCurrentImageIndex(newIndex);
      }
    },
    [currentImageIndex],
  );

  const handleOpenAdjustSheet = () => {
    if (isEditing) return;
    adjustRecipeSheetRef.current?.present();
  };

  const handleOpenMealPlanSheet = () => {
    addToMealPlanSheetRef.current?.present();
  };

  const handleOpenShoppingListSheet = () => {
    if (!recipe) return;
    shoppingListSheetRef.current?.present();
  };

  const handleOpenPersonaliseSheet = useCallback(async () => {
    if (!recipe || isPreviewMode || isEditing) return;
    const allowed = await requireProFeature("Personalise recipe");
    if (!allowed) return;
    personaliseRecipeSheetRef.current?.present();
  }, [isEditing, isPreviewMode, recipe, requireProFeature]);

  const handleOpenReviewSheet = useCallback(() => {
    if (!recipe || !isOwnRecipe || isPreviewMode || isEditing) return;
    cookingReviewSheetRef.current?.present();
  }, [isEditing, isOwnRecipe, isPreviewMode, recipe]);

  const handleViewSource = useCallback(async () => {
    if (!recipeSourceUrl) return;

    await openExternalWebsite(recipeSourceUrl);
  }, [recipeSourceUrl]);

  const handleStartCookMode = () => {
    if (!recipe) return;

    navigation.navigate("CookMode", {
      recipeName: recipe.name,
      ingredientSections: recipe.ingredientSections,
      instructionSections: recipe.instructionSections,
    });
  };

  const handleSubmitReview = async (data: {
    rating: number;
    reviewText?: string;
    imageUrls?: string[];
  }) => {
    if (!recipe) return;

    const uploadedReviewImages = data.imageUrls?.length
      ? await uploadImages(data.imageUrls, "review_photo")
      : [];

    await createCookingReviewMutation.mutateAsync({
      recipeId: recipe.id,
      rating: data.rating,
      reviewText: data.reviewText,
      imageUploadIds: uploadedReviewImages.map((image) => image.key),
    });
    setRatingOverride(data.rating);
  };

  const handleImportRecipe = async () => {
    if (!recipe) return;

    try {
      const newRecipe = await importMutation.mutateAsync({
        recipeId: recipe.id,
      });
      navigation.dispatch(
        StackActions.replace("RecipeDetail", { recipeId: newRecipe.id }),
      );
    } catch (error: unknown) {
      alertApiError("Import Failed", error, {
        operation: "recipe.importExisting",
        fallback: "Something went wrong while importing the recipe.",
      });
    }
  };

  const handlePersonaliseRecipe = async (input: {
    goals: Parameters<typeof personalizeRecipeMutation.mutateAsync>[0]["goals"];
    allergyNotes?: string;
    customNotes?: string;
  }) => {
    if (!recipe) return;

    try {
      const result = await personalizeRecipeMutation.mutateAsync({
        recipeId: recipe.id,
        goals: input.goals,
        allergyNotes: input.allergyNotes,
        customNotes: input.customNotes,
      });
      personaliseRecipeSheetRef.current?.dismiss();
      navigation.navigate("RecipeDetail", {
        parsedRecipe: result as ParsedRecipe,
        mode: "edit",
      });
    } catch (error: unknown) {
      alertApiError("Personalisation Failed", error, {
        operation: "recipe.personalize",
        fallback: "Something went wrong while personalising the recipe.",
      });
    }
  };

  const handleAddRecipeImage = useCallback(
    async (pickedUri: string) => {
      const imageId = createDraftId("image");
      setDraft((current) =>
        current
          ? {
              ...current,
              images: [
                ...current.images,
                { id: imageId, uri: pickedUri, isRemote: false },
              ],
            }
          : current,
      );

      try {
        const [uploadResult] = await uploadImages([pickedUri]);
        if (!uploadResult) return;

        setDraft((current) =>
          current
            ? {
                ...current,
                images: current.images.map((image) =>
                  image.id === imageId
                    ? { ...image, uploadKey: uploadResult.key }
                    : image,
                ),
              }
            : current,
        );
      } catch {
        setDraft((current) =>
          current
            ? {
                ...current,
                images: current.images.filter((image) => image.id !== imageId),
              }
            : current,
        );
      }
    },
    [uploadImages],
  );

  const handleChooseRecipeImage = useCallback(async () => {
    const hasPermission = await ensureMediaLibraryPermission({
      message: "Please allow access to your photos to add a recipe image.",
    });
    if (!hasPermission) return;

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 1,
      });

      const pickedAsset = result.assets?.[0];
      if (result.canceled || !pickedAsset) return;
      await handleAddRecipeImage(pickedAsset.uri);
    } catch (error) {
      console.error("Failed to pick recipe image:", error);
      Alert.alert("Photo Error", "Unable to open your photo library.");
    }
  }, [handleAddRecipeImage]);

  const handleTakeRecipePhoto = useCallback(async () => {
    const hasPermission = await ensureCameraPermission({
      message: "Please allow camera access to take a recipe photo.",
    });
    if (!hasPermission) return;

    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 1,
      });

      const capturedAsset = result.assets?.[0];
      if (result.canceled || !capturedAsset) return;
      await handleAddRecipeImage(capturedAsset.uri);
    } catch (error) {
      console.error("Failed to take recipe photo:", error);
      Alert.alert("Camera Error", "Unable to take a photo.");
    }
  }, [handleAddRecipeImage]);

  const handlePickRecipeImage = useCallback(() => {
    Alert.alert("Add recipe image", undefined, [
      {
        text: "Take Photo",
        onPress: handleTakeRecipePhoto,
      },
      {
        text: "Choose from Library",
        onPress: handleChooseRecipeImage,
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }, [handleChooseRecipeImage, handleTakeRecipePhoto]);

  const handleGenerateRecipeImage = useCallback(async () => {
    if (!draft) return;

    const allowed = await requireProFeature("AI image");
    if (!allowed) return;

    if (!draft.name.trim()) {
      Alert.alert(
        "Add a title",
        "Add a recipe title before creating an image.",
      );
      return;
    }

    const ingredients = draft.ingredientSections.flatMap((section) =>
      section.ingredients
        .map((ingredient) => ingredient.text.trim())
        .filter(Boolean),
    );
    const instructions = draft.instructionSections.flatMap((section) =>
      section.instructions
        .map((instruction) => instruction.instruction.trim())
        .filter(Boolean),
    );

    try {
      const result = await generateRecipeImageMutation.mutateAsync({
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        ingredients,
        instructions,
      });

      const imageId = createDraftId("generated-image");
      const nextImageIndex = draft.images.length;
      pendingImageScrollIndexRef.current = nextImageIndex;
      pendingImageScrollAnimatedRef.current = true;
      updateDraft((current) => ({
        ...current,
        images: [
          ...current.images,
          {
            id: imageId,
            uri: result.publicUrl,
            isRemote: false,
            uploadKey: result.imageUploadId,
          },
        ],
      }));
    } catch (error: unknown) {
      alertApiError("Image Creation Failed", error, {
        operation: "recipe.generateImage",
        fallback: "Something went wrong while creating the image.",
      });
    }
  }, [draft, generateRecipeImageMutation, requireProFeature, updateDraft]);

  const handleRemoveImage = useCallback(
    (imageIndex: number) => {
      if (!draft) return;
      const remaining = draft.images.length - 1;

      if (imageIndex < currentImageIndex) {
        // The carousel keeps its offset, so follow the photo we were on.
        pendingImageScrollIndexRef.current = currentImageIndex - 1;
        pendingImageScrollAnimatedRef.current = false;
      } else if (imageIndex === currentImageIndex) {
        // The next photo slides into place; only clamp at the end.
        setCurrentImageIndex(
          Math.max(0, Math.min(currentImageIndex, remaining - 1)),
        );
      }

      updateDraft((current) => ({
        ...current,
        images: current.images.filter((_, index) => index !== imageIndex),
      }));
    },
    [currentImageIndex, draft, updateDraft],
  );

  const handleReorderImages = useCallback(
    (ids: string[]) => {
      updateDraft((current) => {
        const byId = new Map(current.images.map((image) => [image.id, image]));
        const reordered = ids
          .map((id) => byId.get(id))
          .filter((image): image is DraftImage => Boolean(image));
        // Keep anything added while the sheet was open.
        const rest = current.images.filter((image) => !ids.includes(image.id));
        return { ...current, images: [...reordered, ...rest] };
      });
      // Show the cover, which is what a reorder is usually about.
      pendingImageScrollIndexRef.current = 0;
      pendingImageScrollAnimatedRef.current = false;
    },
    [updateDraft],
  );

  const handleRemoveImageById = useCallback(
    (id: string) => {
      const index = draft?.images.findIndex((image) => image.id === id) ?? -1;
      if (index >= 0) handleRemoveImage(index);
    },
    [draft, handleRemoveImage],
  );

  const draftPhotoItems = useMemo<RecipePhotoItem[]>(
    () =>
      (draft?.images ?? []).map((image) => {
        const progress = uploadProgress[image.uri];
        return {
          id: image.id,
          uri: image.isRemote
            ? (getImageUrl(image.asset ?? image.uri, "recipe-card") ?? null)
            : image.uri,
          isUploading:
            progress !== undefined && progress >= 0 && progress < 100,
        };
      }),
    [draft?.images, uploadProgress],
  );

  const addIngredient = useCallback(
    (sectionId: string) => {
      updateDraft((current) => ({
        ...current,
        ingredientSections: current.ingredientSections.map((section) =>
          section.id === sectionId
            ? {
                ...section,
                ingredients: [
                  ...section.ingredients,
                  { id: createDraftId("ingredient"), text: "" },
                ],
              }
            : section,
        ),
      }));
    },
    [updateDraft],
  );

  const updateIngredient = useCallback(
    (sectionId: string, ingredientId: string, text: string) => {
      updateDraft((current) => ({
        ...current,
        ingredientSections: current.ingredientSections.map((section) =>
          section.id === sectionId
            ? {
                ...section,
                ingredients: section.ingredients.map((ingredient) =>
                  ingredient.id === ingredientId
                    ? { ...ingredient, text }
                    : ingredient,
                ),
              }
            : section,
        ),
      }));
    },
    [updateDraft],
  );

  const removeIngredient = useCallback(
    (sectionId: string, ingredientId: string) => {
      updateDraft((current) => ({
        ...current,
        ingredientSections: current.ingredientSections.map((section) =>
          section.id === sectionId
            ? {
                ...section,
                ingredients:
                  section.ingredients.length > 1
                    ? section.ingredients.filter(
                        (ingredient) => ingredient.id !== ingredientId,
                      )
                    : [{ id: createDraftId("ingredient"), text: "" }],
              }
            : section,
        ),
      }));
    },
    [updateDraft],
  );

  const addIngredientSection = useCallback(() => {
    updateDraft((current) => ({
      ...current,
      ingredientSections: [
        ...current.ingredientSections,
        {
          id: createDraftId("ingredient-section"),
          name: "",
          ingredients: [{ id: createDraftId("ingredient"), text: "" }],
        },
      ],
    }));
  }, [updateDraft]);

  const updateIngredientSectionName = useCallback(
    (sectionId: string, name: string) => {
      updateDraft((current) => ({
        ...current,
        ingredientSections: current.ingredientSections.map((section) =>
          section.id === sectionId ? { ...section, name } : section,
        ),
      }));
    },
    [updateDraft],
  );

  const removeIngredientSection = useCallback(
    (sectionId: string) => {
      updateDraft((current) => {
        const nextSections = current.ingredientSections.filter(
          (section) => section.id !== sectionId,
        );
        return {
          ...current,
          ingredientSections:
            nextSections.length > 0
              ? nextSections
              : [
                  {
                    id: createDraftId("ingredient-section"),
                    name: "",
                    ingredients: [
                      { id: createDraftId("ingredient"), text: "" },
                    ],
                  },
                ],
        };
      });
    },
    [updateDraft],
  );

  const addInstruction = useCallback(
    (sectionId: string) => {
      updateDraft((current) => ({
        ...current,
        instructionSections: current.instructionSections.map((section) =>
          section.id === sectionId
            ? {
                ...section,
                instructions: [
                  ...section.instructions,
                  {
                    id: createDraftId("instruction"),
                    instruction: "",
                    imageUrl: null,
                  },
                ],
              }
            : section,
        ),
      }));
    },
    [updateDraft],
  );

  const updateInstruction = useCallback(
    (sectionId: string, instructionId: string, instruction: string) => {
      updateDraft((current) => ({
        ...current,
        instructionSections: current.instructionSections.map((section) =>
          section.id === sectionId
            ? {
                ...section,
                instructions: section.instructions.map((item) =>
                  item.id === instructionId ? { ...item, instruction } : item,
                ),
              }
            : section,
        ),
      }));
    },
    [updateDraft],
  );

  const removeInstruction = useCallback(
    (sectionId: string, instructionId: string) => {
      updateDraft((current) => ({
        ...current,
        instructionSections: current.instructionSections.map((section) =>
          section.id === sectionId
            ? {
                ...section,
                instructions:
                  section.instructions.length > 1
                    ? section.instructions.filter(
                        (instruction) => instruction.id !== instructionId,
                      )
                    : [
                        {
                          id: createDraftId("instruction"),
                          instruction: "",
                          imageUrl: null,
                        },
                      ],
              }
            : section,
        ),
      }));
    },
    [updateDraft],
  );

  const addInstructionSection = useCallback(() => {
    updateDraft((current) => ({
      ...current,
      instructionSections: [
        ...current.instructionSections,
        {
          id: createDraftId("instruction-section"),
          name: "",
          instructions: [
            {
              id: createDraftId("instruction"),
              instruction: "",
              imageUrl: null,
            },
          ],
        },
      ],
    }));
  }, [updateDraft]);

  const updateInstructionSectionName = useCallback(
    (sectionId: string, name: string) => {
      updateDraft((current) => ({
        ...current,
        instructionSections: current.instructionSections.map((section) =>
          section.id === sectionId ? { ...section, name } : section,
        ),
      }));
    },
    [updateDraft],
  );

  const removeInstructionSection = useCallback(
    (sectionId: string) => {
      updateDraft((current) => {
        const nextSections = current.instructionSections.filter(
          (section) => section.id !== sectionId,
        );
        return {
          ...current,
          instructionSections:
            nextSections.length > 0
              ? nextSections
              : [
                  {
                    id: createDraftId("instruction-section"),
                    name: "",
                    instructions: [
                      {
                        id: createDraftId("instruction"),
                        instruction: "",
                        imageUrl: null,
                      },
                    ],
                  },
                ],
        };
      });
    },
    [updateDraft],
  );

  const removeStepImage = useCallback(
    (sectionId: string, instructionId: string) => {
      updateDraft((current) => ({
        ...current,
        instructionSections: current.instructionSections.map((section) =>
          section.id === sectionId
            ? {
                ...section,
                instructions: section.instructions.map((instruction) =>
                  instruction.id === instructionId
                    ? { ...instruction, imageUrl: null }
                    : instruction,
                ),
              }
            : section,
        ),
      }));
    },
    [updateDraft],
  );

  const updateDraftTags = useCallback(
    (tagNames: string[]) => {
      updateDraft((current) => ({
        ...current,
        tagNames,
      }));
    },
    [updateDraft],
  );

  const handleCancelEdit = useCallback(() => {
    const isDirty =
      JSON.stringify(draft) !== JSON.stringify(initialDraftRef.current);

    const cancel = () => {
      setHasAttemptedSave(false);
      if (isCreateMode) {
        navigation.goBack();
        return;
      }

      if (initialDraftRef.current) {
        setDraft(initialDraftRef.current);
      }
      setCurrentImageIndex(0);
      setIsEditing(false);
    };

    if (!isDirty) {
      cancel();
      return;
    }

    Alert.alert("Discard changes?", "Your recipe edits will be lost.", [
      { text: "Keep Editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: cancel },
    ]);
  }, [draft, isCreateMode, navigation]);

  const handleDismissImportReview = useCallback(() => {
    if (!importJobId || isDismissingImportRef.current) return;

    isDismissingImportRef.current = true;
    navigation.goBack();

    dismissImport(importJobId).catch((dismissError) => {
      alertApiError("Dismiss Failed", dismissError, {
        operation: "recipeImport.dismiss",
        fallback: "Unable to dismiss this import.",
      });
    });
  }, [dismissImport, importJobId, navigation]);

  const handleSaveDraft = useCallback(async () => {
    if (!draft) return;

    const errors = getRecipeDraftValidationErrors(draft);
    if (errors.length > 0) {
      setHasAttemptedSave(true);
      const firstError = errors[0];
      if (firstError) scrollToDraftError(firstError.field);
      return;
    }

    setHasAttemptedSave(false);

    if (isUploadingImages) {
      Alert.alert("Please wait", "Recipe photos are still uploading.");
      return;
    }

    const pendingUploads = draft.images.filter(
      (image) => !image.isRemote && !image.uploadKey,
    );
    if (pendingUploads.length > 0) {
      Alert.alert("Upload Required", "Please remove or re-add failed photos.");
      return;
    }

    const recipeData = draftToMutationInput(draft);

    try {
      if (recipeId && !isCreateMode) {
        await updateRecipeMutation.mutateAsync({
          recipeId,
          ...recipeData,
        });
        initialDraftRef.current = draft;
        setServings(draft.servings);
        setCurrentImageIndex(0);
        setIsEditing(false);
      } else {
        const { id } = importJobId
          ? await completeImportMutation.mutateAsync({
              id: importJobId,
              recipe: recipeData,
            })
          : await saveRecipeMutation.mutateAsync(recipeData);
        navigation.dispatch(
          StackActions.replace("RecipeDetail", { recipeId: id }),
        );
      }
    } catch (error: unknown) {
      alertApiError("Save Failed", error, {
        operation: isCreateMode ? "recipe.create" : "recipe.update",
        fallback: "Something went wrong while saving the recipe.",
      });
    }
  }, [
    draft,
    completeImportMutation,
    importJobId,
    isCreateMode,
    isUploadingImages,
    navigation,
    recipeId,
    saveRecipeMutation,
    scrollToDraftError,
    updateRecipeMutation,
  ]);

  const handleBlockRecipeOwner = useCallback(() => {
    const owner = recipe?.owner;
    if (!owner) return;

    Alert.alert(
      `Block ${owner.name}?`,
      "You will no longer see each other's profiles or content. Previous follows will be removed.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block",
          style: "destructive",
          onPress: async () => {
            try {
              await blockUserMutation.mutateAsync({ userId: owner.id });
              navigation.goBack();
            } catch (error) {
              alertApiError("Block Failed", error, {
                operation: "moderation.blockUser",
                fallback: "Could not block this user. Please try again.",
              });
            }
          },
        },
      ],
    );
  }, [blockUserMutation, navigation, recipe?.owner]);

  const handleDeleteRecipe = useCallback(() => {
    if (recipeId === null) return;

    Alert.alert(
      "Delete Recipe",
      "Are you sure you want to delete this recipe? This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteMutation.mutateAsync({ recipeId });
              navigation.goBack();
            } catch (error: unknown) {
              alertApiError("Delete Failed", error, {
                operation: "recipe.delete",
                fallback: "Failed to delete recipe. Please try again.",
              });
            }
          },
        },
      ],
    );
  }, [deleteMutation, navigation, recipeId]);

  const recipeMenuOptions = useMemo<CommentOption[]>(() => {
    if (isEditing || isPreviewMode || !recipe) return [];

    const options: CommentOption[] = [
      {
        key: "personalise",
        label: "Personalise with AI",
        systemImage: "sparkles",
        run: () => {
          handleOpenPersonaliseSheet().catch(() => {});
        },
      },
    ];

    if (isOwnRecipe) {
      options.push(
        {
          key: "collections",
          label: "Manage Collections",
          systemImage: "bookmark",
          run: () => collectionSheetRef.current?.present(),
        },
        {
          key: "rate",
          label: displayedRating
            ? `Your Rating: ${displayedRating}/5`
            : "Rate Recipe",
          systemImage: displayedRating ? "star.fill" : "star",
          run: handleOpenReviewSheet,
        },
      );
    }

    if (recipeSourceUrl) {
      options.push({
        key: "source",
        label: "View Original Recipe",
        systemImage: "safari",
        run: () => {
          handleViewSource().catch(() => {});
        },
      });
    }

    if (isOwnRecipe) {
      options.push({
        key: "delete",
        label: "Delete Recipe",
        systemImage: "trash",
        destructive: true,
        run: handleDeleteRecipe,
      });
    } else if (recipeId !== null) {
      options.push(
        {
          key: "report",
          label: "Report Recipe",
          systemImage: "flag",
          run: () =>
            reportSheetRef.current?.present({
              targetType: "recipe",
              targetId: String(recipeId),
            }),
        },
        {
          key: "block",
          label: "Block Recipe Author",
          systemImage: "hand.raised",
          destructive: true,
          run: handleBlockRecipeOwner,
        },
      );
    }

    return options;
  }, [
    displayedRating,
    handleBlockRecipeOwner,
    handleDeleteRecipe,
    handleOpenPersonaliseSheet,
    handleOpenReviewSheet,
    handleViewSource,
    isEditing,
    isOwnRecipe,
    isPreviewMode,
    recipe,
    recipeId,
    recipeSourceUrl,
  ]);
  const canEditRecipe = !isEditing && !isPreviewMode && isOwnRecipe;
  const showViewActionBar = !isEditing && !isPreviewMode && Boolean(recipe);

  useLayoutEffect(() => {
    const headerRightItems: NativeStackHeaderItem[] = [];

    if (canEditRecipe) {
      headerRightItems.push({
        type: "button",
        label: "Edit",
        icon: { type: "sfSymbol", name: "pencil" },
        onPress: handleEnterEditMode,
      });
    }

    if (recipeMenuOptions.length > 0) {
      headerRightItems.push({
        type: "menu",
        label: "Recipe options",
        icon: { type: "sfSymbol", name: "ellipsis" },
        menu: {
          items: recipeMenuOptions.map((option) => ({
            type: "action" as const,
            label: option.label,
            icon: { type: "sfSymbol" as const, name: option.systemImage },
            destructive: option.destructive,
            onPress: option.run,
          })),
        },
      });
    }

    navigation.setOptions({
      headerTitle: "",
      unstable_headerRightItems:
        Platform.OS === "ios" ? () => headerRightItems : undefined,
      headerRight:
        Platform.OS === "android" && headerRightItems.length > 0
          ? ({ tintColor }: NativeStackHeaderItemProps) => (
              <View style={styles.androidHeaderActions}>
                {canEditRecipe ? (
                  <Pressable
                    accessibilityLabel="Edit recipe"
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={handleEnterEditMode}
                    style={({ pressed }) => [
                      styles.androidHeaderMenuButton,
                      pressed && styles.androidHeaderMenuButtonPressed,
                    ]}
                  >
                    <Ionicons color={tintColor} name="pencil" size={22} />
                  </Pressable>
                ) : null}
                {recipeMenuOptions.length > 0 ? (
                  <CommentOptionsMenu
                    options={recipeMenuOptions}
                    accessibilityLabel="Recipe options"
                  >
                    <View style={styles.androidHeaderMenuButton}>
                      <Ionicons
                        color={tintColor}
                        name="ellipsis-horizontal"
                        size={24}
                      />
                    </View>
                  </CommentOptionsMenu>
                ) : null}
              </View>
            )
          : undefined,
    });
  }, [canEditRecipe, handleEnterEditMode, navigation, recipeMenuOptions]);

  if (!isBlankDraftMode && !isPending && (error || !recipe)) {
    const resolvedError = resolvePublicError(error, "Recipe not found.");
    const isExternalRecipe = resolvedError.code === "EXTERNAL_RECIPE_SOURCE";
    const { sourceUrl } = publicErrorDetails(error);
    const forbiddenSourceWebsiteName = getSourceWebsiteName(sourceUrl);

    return (
      <View style={[styles.screen, styles.centered]}>
        <Text type="bodyFaded">
          {isExternalRecipe
            ? "This recipe is from an external website"
            : "Recipe not found"}
        </Text>
        <VSpace size={16} />
        {isImportReviewMode ? (
          <PrimaryButton
            onPress={() => {
              importDetailQuery.refetch().catch(() => {});
            }}
          >
            Retry
          </PrimaryButton>
        ) : null}
        {isExternalRecipe && sourceUrl ? (
          <>
            <PrimaryButton
              onPress={() => {
                return openExternalWebsite(sourceUrl);
              }}
            >
              {forbiddenSourceWebsiteName
                ? `View on ${forbiddenSourceWebsiteName}`
                : "View on Original Site"}
            </PrimaryButton>
            <VSpace size={8} />
            <TouchableOpacity onPress={() => navigation.goBack()}>
              <Text type="bodyFaded">Go Back</Text>
            </TouchableOpacity>
          </>
        ) : (
          <PrimaryButton onPress={() => navigation.goBack()}>
            Go Back
          </PrimaryButton>
        )}
      </View>
    );
  }

  const renderImage = ({ item }: { item: RecipeImage }) => {
    const preset = selectDetailImagePreset(SCREEN_WIDTH);
    return (
      <View style={styles.imageContainer}>
        <OptimizedImage
          image={recipeImageToSource(item)}
          preset={preset}
          style={styles.recipeImage}
          contentFit="cover"
          transition={200}
        />
      </View>
    );
  };

  const renderDraftImage = ({ item }: { item: DraftImage }) => {
    const progress = uploadProgress[item.uri];
    const isUploading =
      progress !== undefined && progress >= 0 && progress < 100;
    const preset = selectDetailImagePreset(SCREEN_WIDTH);
    const imageUrl = item.isRemote
      ? getImageUrl(item.asset ?? item.uri, preset)
      : item.uri;

    return (
      <View style={styles.imageContainer}>
        {item.asset ? (
          <OptimizedImage
            image={item.asset}
            preset={preset}
            style={styles.recipeImage}
            contentFit="cover"
            transition={200}
          />
        ) : imageUrl ? (
          <Image
            source={{ uri: imageUrl }}
            style={styles.recipeImage}
            contentFit="cover"
            transition={200}
          />
        ) : null}
        {isUploading && (
          <View style={styles.imageUploadOverlay}>
            <ActivityIndicator color="white" />
          </View>
        )}
      </View>
    );
  };

  const renderDraftPhotoStrip = () => {
    if (!isEditing || !draft) return null;
    const count = draft.images.length;
    // Up to three photos fanned behind one another; the cover sits on top.
    const stack = draftPhotoItems.slice(0, 3);

    return (
      <View pointerEvents="box-none" style={styles.photoStripWrap}>
        {renderValidationMessage("images", true, true)}
        <View pointerEvents="box-none" style={styles.photoControls}>
          <GlassSurface
            interactive
            style={styles.photoPill}
            contentStyle={styles.photoPillContent}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${count} ${count === 1 ? "photo" : "photos"}`}
              accessibilityHint="Reorder, remove or add photos"
              onPress={() => recipePhotosSheetRef.current?.present()}
              style={({ pressed }) => [
                styles.photoPillButton,
                pressed && styles.photoStripButtonPressed,
              ]}
            >
              <View
                style={[
                  styles.photoStack,
                  { width: 30 + Math.max(0, stack.length - 1) * 12 },
                ]}
              >
                {stack
                  .map((photo, index) => (
                    <View
                      key={photo.id}
                      style={[styles.photoStackItem, STACK_POSES[index]]}
                    >
                      {photo.uri ? (
                        <Image
                          source={{ uri: photo.uri }}
                          style={styles.photoThumbImage}
                          contentFit="cover"
                        />
                      ) : null}
                    </View>
                  ))
                  .reverse()}
              </View>
              <Text style={styles.photoPillText}>
                {count} {count === 1 ? "photo" : "photos"}
              </Text>
              <Ionicons
                name="chevron-forward"
                size={14}
                style={styles.photoPillChevron}
              />
            </Pressable>
          </GlassSurface>
          <GlassSurface
            interactive
            style={styles.photoAddCircle}
            contentStyle={styles.photoPillContent}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add photo"
              accessibilityHint="Take a photo or choose one from your library"
              onPress={handlePickRecipeImage}
              style={({ pressed }) => [
                styles.photoAddButton,
                pressed && styles.photoStripButtonPressed,
              ]}
            >
              <Ionicons name="add" size={22} style={styles.photoStripIcon} />
            </Pressable>
          </GlassSurface>
        </View>
      </View>
    );
  };

  const renderValidationMessage = (
    field: RecipeDraftValidationField,
    onImage = false,
    centered = false,
  ) => {
    const error = visibleDraftErrors.find((item) => item.field === field);
    if (!error) return null;

    return (
      <Animated.View
        entering={FadeIn.duration(160)}
        exiting={FadeOut.duration(120)}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[
          styles.validationMessage,
          onImage && styles.heroValidationMessage,
          centered && styles.centeredValidationMessage,
        ]}
      >
        <View pointerEvents="none" style={styles.validationMessageTint} />
        <Ionicons
          name="alert-circle"
          size={16}
          style={[
            styles.validationMessageIcon,
            onImage && styles.heroValidationMessageIcon,
          ]}
        />
        <Text
          selectable
          style={[
            styles.validationMessageText,
            onImage && styles.heroValidationMessageText,
          ]}
        >
          {error.message}
        </Text>
      </Animated.View>
    );
  };

  const renderHero = () => {
    if (isEditing && draft) {
      if (draft.images.length === 0) {
        const isCreatingImage = generateRecipeImageMutation.isPending;

        return (
          <View style={styles.imageCarouselContainer}>
            <View style={styles.emptyHero}>
              <Ionicons
                name="image-outline"
                size={30}
                style={styles.emptyHeroIcon}
              />
              <Text style={styles.emptyHeroText}>Add recipe photo</Text>
              {renderValidationMessage("images", false, true)}
              <View style={styles.emptyHeroActions}>
                <TouchableOpacity
                  style={styles.emptyHeroButton}
                  onPress={handlePickRecipeImage}
                  activeOpacity={0.82}
                >
                  <Ionicons
                    name="camera-outline"
                    size={18}
                    style={styles.emptyHeroButtonIcon}
                  />
                  <Text style={styles.emptyHeroButtonText}>Choose photo</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.emptyHeroButton,
                    styles.emptyHeroButtonPrimary,
                    isCreatingImage && styles.heroButtonDisabled,
                  ]}
                  onPress={handleGenerateRecipeImage}
                  activeOpacity={0.82}
                  disabled={isCreatingImage}
                >
                  {isCreatingImage ? (
                    <ActivityIndicator size="small" color="white" />
                  ) : (
                    <Ionicons name="sparkles" size={18} color="white" />
                  )}
                  <Text
                    style={[
                      styles.emptyHeroButtonText,
                      styles.emptyHeroButtonTextPrimary,
                    ]}
                  >
                    Create with AI
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        );
      }

      return (
        <View style={styles.imageCarouselContainer}>
          <Animated.View style={imageAnimatedStyle}>
            <FlatList
              ref={draftImageListRef}
              data={draft.images}
              renderItem={renderDraftImage}
              keyExtractor={(item) => item.id}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              initialNumToRender={1}
              maxToRenderPerBatch={1}
              windowSize={3}
              onMomentumScrollEnd={handleImageScroll}
              getItemLayout={(_, index) => ({
                length: SCREEN_WIDTH,
                offset: SCREEN_WIDTH * index,
                index,
              })}
              onScrollToIndexFailed={({ index }) => {
                draftImageListRef.current?.scrollToOffset({
                  offset: SCREEN_WIDTH * index,
                  animated: true,
                });
              }}
            />
          </Animated.View>
          {renderDraftPhotoStrip()}
        </View>
      );
    }

    return (
      <View style={styles.imageCarouselContainer}>
        {recipe?.images && recipe.images.length > 0 ? (
          <>
            <Animated.View style={imageAnimatedStyle}>
              <FlatList
                data={recipe.images}
                renderItem={renderImage}
                keyExtractor={(item) => item.id.toString()}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                initialNumToRender={1}
                maxToRenderPerBatch={1}
                windowSize={3}
                onMomentumScrollEnd={handleImageScroll}
                getItemLayout={(_, index) => ({
                  length: SCREEN_WIDTH,
                  offset: SCREEN_WIDTH * index,
                  index,
                })}
              />
            </Animated.View>
            <PageIndicator
              currentPage={currentImageIndex + 1}
              totalPages={recipe.images.length}
            />
          </>
        ) : (
          <Skeleton
            width={SCREEN_WIDTH}
            height={IMAGE_HEIGHT}
            borderRadius={0}
          />
        )}
      </View>
    );
  };

  const measurementLabel =
    measurementSystem === "metric"
      ? "Metric"
      : measurementSystem === "imperial"
        ? "Imperial"
        : "Units";

  const renderIngredients = () => {
    if (!recipe) return null;
    return (
      <View style={styles.tabContent}>
        {recipe.ingredientSections.map((section, sectionIndex) => (
          <View
            key={section.id}
            style={sectionIndex > 0 ? styles.contentSectionGroup : null}
          >
            {section.name && (
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{section.name}</Text>
              </View>
            )}

            {section.ingredients.map((item, itemIndex) => {
              const isLastRow =
                sectionIndex === recipe.ingredientSections.length - 1 &&
                itemIndex === section.ingredients.length - 1;
              let adjustedQuantity = item.quantity
                ? parseFloat(item.quantity) * servingMultiplier
                : null;
              let displayUnit = formatUnit(item.unit, adjustedQuantity);

              if (
                measurementSystem !== "auto" &&
                adjustedQuantity &&
                item.unit
              ) {
                const converted = convertParsedIngredient(
                  adjustedQuantity,
                  item.unit,
                  measurementSystem,
                  item.name,
                );
                if (converted) {
                  adjustedQuantity = converted.quantity;
                  displayUnit = formatUnit(converted.unit, converted.quantity);
                }
              }

              const formattedQuantity = adjustedQuantity
                ? adjustedQuantity % 1 === 0
                  ? adjustedQuantity.toString()
                  : adjustedQuantity.toFixed(2).replace(/\.?0+$/, "")
                : null;

              const needsSpace = displayUnit && !isCompactUnit(displayUnit);

              return (
                <View
                  key={item.id}
                  style={[
                    styles.ingredientItem,
                    isLastRow && styles.ingredientItemLast,
                  ]}
                >
                  <Text style={styles.ingredientQuantity}>
                    {formattedQuantity}
                    {formattedQuantity && displayUnit && needsSpace ? " " : ""}
                    {displayUnit}
                  </Text>
                  <Text style={styles.ingredientName}>
                    {item.name}
                    {item.preparation ? (
                      <Text style={styles.ingredientPreparation}>
                        , {item.preparation}
                      </Text>
                    ) : null}
                  </Text>
                </View>
              );
            })}
          </View>
        ))}
      </View>
    );
  };

  const renderEditableIngredients = () => {
    if (!draft) return null;
    return (
      <View style={styles.tabContent}>
        {draft.ingredientSections.map((section, sectionIndex) => (
          <Animated.View
            key={section.id}
            layout={LinearTransition.duration(180)}
            style={sectionIndex > 0 ? styles.contentSectionGroup : null}
          >
            <View style={styles.editSectionHeader}>
              <TextInput
                defaultValue={section.name}
                onChangeText={(name) =>
                  updateIngredientSectionName(section.id, name)
                }
                placeholder="Section name"
                placeholderTextColor={styles.placeholderText.color}
                style={styles.editSectionInput}
                multiline
                textAlignVertical="top"
              />
              <TouchableOpacity
                style={styles.editRemoveIcon}
                onPress={() => removeIngredientSection(section.id)}
                accessibilityLabel="Remove ingredient section"
              >
                <Ionicons
                  name="trash-outline"
                  size={17}
                  style={styles.editIcon}
                />
              </TouchableOpacity>
            </View>

            {section.ingredients.map((ingredient, ingredientIndex) => (
              <Animated.View
                key={ingredient.id}
                layout={LinearTransition.duration(180)}
                entering={FadeIn.duration(150)}
                exiting={FadeOut.duration(120)}
                style={styles.editIngredientRow}
              >
                <TextInput
                  defaultValue={ingredient.text}
                  onChangeText={(text) =>
                    updateIngredient(section.id, ingredient.id, text)
                  }
                  placeholder="2 cups flour"
                  placeholderTextColor={styles.placeholderText.color}
                  style={[
                    styles.editIngredientInput,
                    sectionIndex === 0 &&
                      ingredientIndex === 0 &&
                      hasVisibleDraftError("ingredients") &&
                      styles.editInputError,
                  ]}
                  multiline
                  textAlignVertical="top"
                />
                <TouchableOpacity
                  style={styles.editRemoveIcon}
                  onPress={() => removeIngredient(section.id, ingredient.id)}
                  accessibilityLabel="Remove ingredient"
                >
                  <Ionicons name="remove" size={18} style={styles.editIcon} />
                </TouchableOpacity>
              </Animated.View>
            ))}

            <TouchableOpacity
              style={styles.inlineAddButton}
              onPress={() => addIngredient(section.id)}
            >
              <Ionicons name="add" size={17} style={styles.inlineAddIcon} />
              <Text style={styles.inlineAddText}>Add ingredient</Text>
            </TouchableOpacity>
          </Animated.View>
        ))}

        <Animated.View layout={LinearTransition.duration(180)}>
          <TouchableOpacity
            style={styles.addSectionButton}
            onPress={addIngredientSection}
          >
            <Ionicons
              name="add-circle-outline"
              size={18}
              style={styles.inlineAddIcon}
            />
            <Text style={styles.addSectionText}>Add ingredient section</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    );
  };

  const renderMethod = () => {
    if (!recipe) return null;

    return (
      <View style={styles.tabContent}>
        {recipe.instructionSections.map((section, sectionIndex) => (
          <View
            key={section.id}
            style={sectionIndex > 0 ? styles.contentSectionGroup : null}
          >
            {section.name && (
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{section.name}</Text>
              </View>
            )}

            {section.instructions.map((item, instructionIndex) => {
              const stepImageUrl = item.imageUrl
                ? getImageUrl(item.imageUrl, "step-thumb")
                : undefined;
              return (
                <View key={item.id} style={styles.instructionItem}>
                  <View style={styles.stepMarkerColumn}>
                    <View style={styles.stepNumberBadge}>
                      <Text style={styles.stepNumber}>
                        {instructionIndex + 1}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.instructionContent}>
                    <Text style={styles.instructionText}>
                      {item.instruction}
                    </Text>
                    {stepImageUrl && (
                      <>
                        <VSpace size={14} />
                        <TouchableOpacity
                          onPress={() => setExpandedImageUrl(item.imageUrl!)}
                          style={styles.stepImageThumbnail}
                        >
                          <Image
                            source={{
                              uri: stepImageUrl,
                            }}
                            style={styles.stepImage}
                            contentFit="cover"
                          />
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        ))}
      </View>
    );
  };

  const renderEditableMethod = () => {
    if (!draft) return null;

    return (
      <View style={styles.tabContent}>
        {draft.instructionSections.map((section, sectionIndex) => (
          <Animated.View
            key={section.id}
            layout={LinearTransition.duration(180)}
            style={sectionIndex > 0 ? styles.contentSectionGroup : null}
          >
            <View style={styles.editSectionHeader}>
              <TextInput
                defaultValue={section.name}
                onChangeText={(name) =>
                  updateInstructionSectionName(section.id, name)
                }
                placeholder="Section name"
                placeholderTextColor={styles.placeholderText.color}
                style={styles.editSectionInput}
                multiline
                textAlignVertical="top"
              />
              <TouchableOpacity
                style={styles.editRemoveIcon}
                onPress={() => removeInstructionSection(section.id)}
                accessibilityLabel="Remove method section"
              >
                <Ionicons
                  name="trash-outline"
                  size={17}
                  style={styles.editIcon}
                />
              </TouchableOpacity>
            </View>

            {section.instructions.map((instruction, instructionIndex) => {
              const stepImageUrl = instruction.imageUrl
                ? getImageUrl(instruction.imageUrl, "step-thumb")
                : undefined;
              return (
                <Animated.View
                  key={instruction.id}
                  layout={LinearTransition.duration(180)}
                  entering={FadeIn.duration(150)}
                  exiting={FadeOut.duration(120)}
                  style={styles.editInstructionItem}
                >
                  <View style={styles.stepMarkerColumn}>
                    <View style={styles.stepNumberBadgeEdit}>
                      <Text style={styles.stepNumber}>
                        {instructionIndex + 1}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.instructionContent}>
                    <TextInput
                      defaultValue={instruction.instruction}
                      onChangeText={(text) =>
                        updateInstruction(section.id, instruction.id, text)
                      }
                      placeholder="Describe this step..."
                      placeholderTextColor={styles.placeholderText.color}
                      style={styles.editInstructionInput}
                      multiline
                    />
                    {stepImageUrl ? (
                      <View style={styles.editStepImageWrap}>
                        <Image
                          source={{
                            uri: stepImageUrl,
                          }}
                          style={styles.stepImage}
                          contentFit="cover"
                        />
                        <TouchableOpacity
                          style={styles.removeStepImageButton}
                          onPress={() =>
                            removeStepImage(section.id, instruction.id)
                          }
                        >
                          <Ionicons name="close" size={18} color="white" />
                        </TouchableOpacity>
                      </View>
                    ) : null}
                  </View>
                  <TouchableOpacity
                    style={styles.editRemoveIcon}
                    onPress={() =>
                      removeInstruction(section.id, instruction.id)
                    }
                    accessibilityLabel="Remove method step"
                  >
                    <Ionicons name="remove" size={18} style={styles.editIcon} />
                  </TouchableOpacity>
                </Animated.View>
              );
            })}

            <TouchableOpacity
              style={styles.inlineAddButton}
              onPress={() => addInstruction(section.id)}
            >
              <Ionicons name="add" size={17} style={styles.inlineAddIcon} />
              <Text style={styles.inlineAddText}>Add step</Text>
            </TouchableOpacity>
          </Animated.View>
        ))}

        <Animated.View layout={LinearTransition.duration(180)}>
          <TouchableOpacity
            style={styles.addSectionButton}
            onPress={addInstructionSection}
          >
            <Ionicons
              name="add-circle-outline"
              size={18}
              style={styles.inlineAddIcon}
            />
            <Text style={styles.addSectionText}>Add method section</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    );
  };

  const renderAttribution = () => {
    // The original site is always credited. In edit mode it is shown but
    // can't be changed or removed.
    const sourceName = isEditing
      ? getSourceWebsiteName(draft?.sourceUrl)
      : isPreviewMode
        ? null
        : sourceWebsiteName;
    const showCreator =
      !isEditing && !isPreviewMode && !isOwnRecipe && Boolean(recipe);

    if (!sourceName && !showCreator) return null;

    return (
      <View style={styles.attributionRow}>
        {sourceName ? (
          isEditing ? (
            <View
              style={styles.sourceLink}
              accessible
              accessibilityLabel={`From ${sourceName}`}
            >
              <Ionicons
                name="globe-outline"
                size={15}
                style={styles.sourceLinkText}
              />
              <Text style={styles.sourceLinkText} numberOfLines={1}>
                {sourceName}
              </Text>
            </View>
          ) : (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={sourceChipAccessibilityLabel}
              hitSlop={8}
              onPress={handleViewSource}
              style={({ pressed }) => [
                styles.sourceLink,
                pressed && styles.pressedFaded,
              ]}
            >
              <Ionicons
                name="globe-outline"
                size={15}
                style={styles.sourceLinkText}
              />
              <Text style={styles.sourceLinkText} numberOfLines={1}>
                {sourceName}
              </Text>
              <Ionicons
                name="open-outline"
                size={13}
                style={styles.sourceLinkText}
              />
            </Pressable>
          )
        ) : null}
        {showCreator && recipe && ownerUsername ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View ${ownerUsername}'s profile`}
            hitSlop={8}
            onPress={() =>
              navigation.navigate("UserProfile", { userId: recipe.owner.id })
            }
            style={({ pressed }) => [
              styles.creatorLink,
              pressed && styles.pressedFaded,
            ]}
          >
            {ownerAvatarUrl ? (
              <Image
                source={{ uri: ownerAvatarUrl }}
                style={styles.creatorAvatar}
                contentFit="cover"
              />
            ) : (
              <View style={styles.creatorAvatarPlaceholder}>
                <Text style={styles.creatorAvatarText}>
                  {ownerUsername.replace(/^@/, "").charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <Text style={styles.creatorText} numberOfLines={1}>
              {ownerUsername}
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  };

  const renderMetaLine = () => {
    if (!recipe) return null;
    const totalMinutes =
      recipe.totalTime ||
      (recipe.prepTime ?? 0) + (recipe.cookTime ?? 0) ||
      null;

    return (
      <View style={styles.metaLine}>
        {totalMinutes ? (
          <View
            style={styles.metaLineItem}
            accessible
            accessibilityLabel={`${formatMinutesShort(totalMinutes)} total`}
          >
            <Ionicons name="time-outline" size={16} style={styles.metaIcon} />
            <Text style={styles.metaLineText}>
              <Text style={styles.metaLineValue}>
                {formatMinutesShort(totalMinutes)}
              </Text>{" "}
              total
            </Text>
          </View>
        ) : null}
        <Pressable
          onPress={handleOpenAdjustSheet}
          accessibilityRole="button"
          accessibilityLabel={`Adjust servings, currently ${servings}`}
          hitSlop={12}
          style={({ pressed }) => [
            styles.metaLineItem,
            pressed && styles.pressedFaded,
          ]}
        >
          <Ionicons name="people-outline" size={16} style={styles.metaIcon} />
          <Text style={styles.metaLineText}>
            Serves <Text style={styles.metaLineValue}>{servings}</Text>
          </Text>
          <Ionicons name="chevron-down" size={13} style={styles.metaIcon} />
        </Pressable>
      </View>
    );
  };

  const renderEditableMeta = () => {
    if (!draft) return null;

    return (
      <View style={styles.metaEditor}>
        <View style={styles.metaWellRow}>
          <View style={styles.metaWell}>
            <Text style={styles.metaWellLabel}>Prep (min)</Text>
            <TextInput
              defaultValue={draft.prepTime?.toString() ?? ""}
              onChangeText={(value) =>
                updateDraft((current) => ({
                  ...current,
                  prepTime: value ? Math.max(0, Number(value) || 0) : null,
                }))
              }
              placeholder="–"
              placeholderTextColor={styles.placeholderText.color}
              keyboardType="number-pad"
              accessibilityLabel="Prep time in minutes"
              style={styles.metaWellInput}
            />
          </View>
          <View style={styles.metaWell}>
            <Text style={styles.metaWellLabel}>Cook (min)</Text>
            <TextInput
              defaultValue={draft.cookTime?.toString() ?? ""}
              onChangeText={(value) =>
                updateDraft((current) => ({
                  ...current,
                  cookTime: value ? Math.max(0, Number(value) || 0) : null,
                }))
              }
              placeholder="–"
              placeholderTextColor={styles.placeholderText.color}
              keyboardType="number-pad"
              accessibilityLabel="Cook time in minutes"
              style={styles.metaWellInput}
            />
          </View>
          <View
            style={[
              styles.metaWell,
              hasVisibleDraftError("servings") && styles.metaInputError,
            ]}
          >
            <Text style={styles.metaWellLabel}>Serves</Text>
            <TextInput
              defaultValue={draft.servings.toString()}
              onChangeText={(value) =>
                updateDraft((current) => ({
                  ...current,
                  servings: value ? Number(value) || 0 : 0,
                }))
              }
              keyboardType="number-pad"
              accessibilityLabel="Servings"
              style={styles.metaWellInput}
            />
          </View>
        </View>
        {renderValidationMessage("servings")}
      </View>
    );
  };

  const formatNutritionNumber = (
    value: number | null | undefined,
    suffix = "",
  ) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    const formatted =
      value % 1 === 0 ? value.toString() : value.toFixed(1).replace(/\.0$/, "");
    return `${formatted}${suffix}`;
  };

  const renderNutritionMetric = (
    label: string,
    value: number | null | undefined,
    suffix = "",
  ) => {
    const formatted = formatNutritionNumber(value, suffix);
    if (!formatted) return null;

    return (
      <View style={styles.nutritionMetric}>
        <Text style={styles.nutritionMetricValue}>{formatted}</Text>
        <Text style={styles.nutritionMetricLabel}>{label}</Text>
      </View>
    );
  };

  const renderNutritionSection = () => {
    if (isEditing || isPreviewMode || !recipe) return null;

    const currentNutrition = nutrition ?? recipe.nutrition;
    const isLoadingNutrition = nutritionMutation.isPending && !currentNutrition;
    const nutritionSubheading =
      currentNutrition?.source === "ai_estimated"
        ? "Estimated per serving"
        : isLoadingNutrition
          ? "Calculating per serving"
          : "Per serving";

    if (!isPro) {
      return (
        <>
          <View style={styles.pageDivider} />
          <View style={styles.recipeSection}>
            <View style={styles.sectionHeadingRow}>
              <Text accessibilityRole="header" style={styles.sectionHeading}>
                Nutrition
              </Text>
              <View style={styles.proBadge}>
                <Text style={styles.proBadgeText}>Pro</Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.nutritionCard}
              onPress={presentPaywall}
              activeOpacity={0.78}
            >
              <Text style={styles.nutritionSubtitle}>
                Upgrade to see per-serving nutrition.
              </Text>
            </TouchableOpacity>
          </View>
        </>
      );
    }

    return (
      <>
        <View style={styles.pageDivider} />
        <View style={styles.recipeSection}>
          <View style={styles.sectionHeadingRow}>
            <Text accessibilityRole="header" style={styles.sectionHeading}>
              Nutrition
            </Text>
            <Text style={styles.sectionSubheading}>{nutritionSubheading}</Text>
          </View>

          <View
            style={
              currentNutrition && !isLoadingNutrition
                ? null
                : styles.nutritionCard
            }
          >
            {isLoadingNutrition ? (
              <View style={styles.nutritionLoadingRow}>
                <ActivityIndicator size="small" />
                <Text style={styles.nutritionSubtitle}>Calculating...</Text>
              </View>
            ) : currentNutrition ? (
              <View style={styles.nutritionGrid}>
                {renderNutritionMetric("Calories", currentNutrition.calories)}
                {renderNutritionMetric(
                  "Protein",
                  currentNutrition.protein,
                  "g",
                )}
                {renderNutritionMetric(
                  "Carbs",
                  currentNutrition.carbohydrates,
                  "g",
                )}
                {renderNutritionMetric("Fat", currentNutrition.fat, "g")}
                {renderNutritionMetric("Fiber", currentNutrition.fiber, "g")}
                {renderNutritionMetric("Sugar", currentNutrition.sugar, "g")}
                {renderNutritionMetric("Sodium", currentNutrition.sodium, "mg")}
              </View>
            ) : (
              <TouchableOpacity
                style={styles.nutritionRetryButton}
                onPress={() => {
                  if (recipe.id > 0) {
                    nutritionMutation.mutate(
                      { recipeId: recipe.id },
                      { onSuccess: (data) => setNutrition(data) },
                    );
                  }
                }}
                activeOpacity={0.76}
              >
                <Text style={styles.nutritionRetryText}>
                  Calculate nutrition
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </>
    );
  };

  const renderEditableTags = () => {
    if (!draft) return null;

    return (
      <Animated.View
        entering={FadeIn.duration(160)}
        exiting={FadeOut.duration(120)}
        layout={LinearTransition.duration(180)}
        style={styles.tagEditor}
      >
        <AutocompleteTagSelector
          selectedNames={draft.tagNames}
          onChange={updateDraftTags}
        />
      </Animated.View>
    );
  };

  const isLoading = !isPreviewMode && !isBlankDraftMode && isPending;
  const ingredientCount = isEditing
    ? (draft?.ingredientSections.reduce(
        (total, section) =>
          total +
          section.ingredients.filter((ingredient) => ingredient.text.trim())
            .length,
        0,
      ) ?? 0)
    : (recipe?.ingredientSections.reduce(
        (total, section) => total + section.ingredients.length,
        0,
      ) ?? 0);
  const instructionCount = isEditing
    ? (draft?.instructionSections.reduce(
        (total, section) =>
          total +
          section.instructions.filter((instruction) =>
            instruction.instruction.trim(),
          ).length,
        0,
      ) ?? 0)
    : (recipe?.instructionSections.reduce(
        (total, section) => total + section.instructions.length,
        0,
      ) ?? 0);
  const expandedStepImageUrl = expandedImageUrl
    ? getImageUrl(expandedImageUrl, "step-full")
    : undefined;
  return (
    <View style={styles.screen}>
      <KeyboardAwareScrollView
        ref={scrollRef}
        enabled={isEditing}
        bottomOffset={isEditing ? editFooterHeight : 0}
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onScroll={scrollHandler}
        scrollEventThrottle={16}
      >
        {renderHero()}

        <View style={styles.whiteCard}>
          {isLoading ? (
            <>
              <View style={styles.summaryPanel}>
                <Skeleton width="82%" height={31} borderRadius={7} />

                <View style={styles.skeletonTextBlock}>
                  <Skeleton width="96%" height={15} borderRadius={4} />
                  <Skeleton width="68%" height={15} borderRadius={4} />
                </View>

                <View style={styles.metaLine}>
                  <Skeleton width={104} height={18} borderRadius={4} />
                  <Skeleton width={92} height={18} borderRadius={4} />
                </View>

                <View style={styles.tagsRow}>
                  <Skeleton width={78} height={28} borderRadius={14} />
                  <Skeleton width={96} height={28} borderRadius={14} />
                  <Skeleton width={64} height={28} borderRadius={14} />
                </View>
              </View>

              <View style={styles.pageDivider} />

              <View style={styles.recipeSection}>
                <View>
                  <Skeleton width={128} height={24} borderRadius={5} />
                  <VSpace size={4} />
                  <Skeleton width={48} height={13} borderRadius={4} />
                </View>
                <View style={styles.tabContent}>
                  {[1, 2, 3, 4].map((i) => (
                    <View key={i} style={styles.ingredientItemSkeleton}>
                      <Skeleton
                        width={i % 2 === 0 ? "72%" : "88%"}
                        height={18}
                        borderRadius={4}
                      />
                    </View>
                  ))}
                </View>
              </View>
            </>
          ) : recipe || draft ? (
            <>
              <Animated.View
                layout={LinearTransition.duration(200)}
                style={[
                  styles.summaryPanel,
                  isEditing && styles.summaryPanelEditing,
                ]}
                onLayout={(event) => {
                  summaryPanelYRef.current = event.nativeEvent.layout.y;
                }}
              >
                {renderAttribution()}

                {isEditing && draft ? (
                  <>
                    {renderValidationMessage("name")}
                    <TextInput
                      defaultValue={draft.name}
                      onChangeText={(name) =>
                        updateDraft((current) => ({ ...current, name }))
                      }
                      placeholder="Recipe title"
                      placeholderTextColor={styles.placeholderText.color}
                      accessibilityLabel="Recipe title"
                      style={[
                        styles.titleInput,
                        hasVisibleDraftError("name") && styles.editInputError,
                      ]}
                      multiline
                      textAlignVertical="top"
                    />
                    <TextInput
                      defaultValue={draft.description}
                      onChangeText={(description) =>
                        updateDraft((current) => ({ ...current, description }))
                      }
                      placeholder="A line or two about the dish"
                      placeholderTextColor={styles.placeholderText.color}
                      accessibilityLabel="Description"
                      style={styles.descriptionInput}
                      multiline
                    />
                  </>
                ) : (
                  <>
                    <Text
                      accessibilityRole="header"
                      style={styles.recipeTitle}
                      selectable
                    >
                      {recipe?.name}
                    </Text>
                    {recipe?.description ? (
                      <Text type="body" style={styles.recipeDescription}>
                        {recipe.description}
                      </Text>
                    ) : null}
                  </>
                )}

                {isEditing && draft ? renderEditableMeta() : renderMetaLine()}

                {!isEditing && recipe?.tags && recipe.tags.length > 0 ? (
                  <Animated.View
                    entering={FadeIn.duration(160)}
                    exiting={FadeOut.duration(120)}
                    style={styles.tagsRow}
                  >
                    {recipe.tags.map((tag) => (
                      <View key={tag.name} style={styles.tagPill}>
                        <Text style={styles.tagText}>{tag.name}</Text>
                      </View>
                    ))}
                  </Animated.View>
                ) : null}

                {isEditing && draft ? renderEditableTags() : null}
              </Animated.View>

              <View style={styles.pageDivider} />

              <View
                style={styles.recipeSection}
                onLayout={(event) => {
                  ingredientSectionYRef.current = event.nativeEvent.layout.y;
                }}
              >
                <View style={styles.sectionHeadingRow}>
                  <Text
                    accessibilityRole="header"
                    style={styles.sectionHeading}
                  >
                    Ingredients
                  </Text>
                  {isEditing ? (
                    <Text style={styles.sectionSubheading}>
                      {ingredientCount} items
                    </Text>
                  ) : (
                    <Pressable
                      onPress={handleOpenAdjustSheet}
                      accessibilityRole="button"
                      accessibilityLabel={`Units: ${measurementLabel}. Adjust servings and units`}
                      hitSlop={12}
                      style={({ pressed }) => [
                        styles.unitsButton,
                        pressed && styles.pressedFaded,
                      ]}
                    >
                      <Text style={styles.unitsButtonText}>
                        {measurementLabel}
                      </Text>
                      <Ionicons
                        name="chevron-down"
                        size={13}
                        style={styles.unitsButtonText}
                      />
                    </Pressable>
                  )}
                </View>
                {isEditing ? renderValidationMessage("ingredients") : null}
                {isEditing ? renderEditableIngredients() : renderIngredients()}
              </View>

              <View style={styles.pageDivider} />

              <View style={styles.recipeSection}>
                <View style={styles.sectionHeadingRow}>
                  <Text
                    accessibilityRole="header"
                    style={styles.sectionHeading}
                  >
                    Method
                  </Text>
                  <Text style={styles.sectionSubheading}>
                    {instructionCount}{" "}
                    {instructionCount === 1 ? "step" : "steps"}
                  </Text>
                </View>
                {isEditing ? renderEditableMethod() : renderMethod()}
              </View>

              {renderNutritionSection()}

              {!isEditing && !isPreviewMode && sourceWebsiteName ? (
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={sourceChipAccessibilityLabel}
                  onPress={handleViewSource}
                  style={({ pressed }) => [
                    styles.originalRecipeCard,
                    pressed && styles.pressedFaded,
                  ]}
                >
                  <View style={styles.originalRecipeIcon}>
                    <Ionicons
                      name="globe-outline"
                      size={18}
                      style={styles.originalRecipeIconGlyph}
                    />
                  </View>
                  <View style={styles.originalRecipeText}>
                    <Text style={styles.originalRecipeLabel}>
                      Original recipe
                    </Text>
                    <Text style={styles.originalRecipeName} numberOfLines={1}>
                      {sourceWebsiteName}
                    </Text>
                  </View>
                  <Ionicons
                    name="open-outline"
                    size={17}
                    style={styles.originalRecipeIconGlyph}
                  />
                </Pressable>
              ) : null}

              {isEditing && !isCreateMode && isOwnRecipe ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={handleDeleteRecipe}
                  style={({ pressed }) => [
                    styles.deleteRecipeButton,
                    pressed && styles.pressedFaded,
                  ]}
                >
                  <Text style={styles.deleteRecipeText}>Delete recipe</Text>
                </Pressable>
              ) : null}

              <VSpace
                size={
                  isEditing || showViewActionBar ? editFooterHeight + 24 : 40
                }
              />
            </>
          ) : null}
        </View>
      </KeyboardAwareScrollView>

      <AdjustRecipeSheet
        ref={adjustRecipeSheetRef}
        servings={servings}
        originalServings={recipe?.servings}
        onServingsChange={setServings}
        measurementSystem={measurementSystem}
        onMeasurementSystemChange={setMeasurementSystem}
      />

      <PersonaliseRecipeSheet
        ref={personaliseRecipeSheetRef}
        isSubmitting={personalizeRecipeMutation.isPending}
        onSubmit={handlePersonaliseRecipe}
      />

      <AddToMealPlanSheet
        ref={addToMealPlanSheetRef}
        recipeId={recipe?.id}
        recipeName={recipe?.name}
      />

      <ShoppingListSelectorSheet
        ref={shoppingListSheetRef}
        recipeId={recipe?.id}
        recipeName={recipe?.name}
        ingredients={shoppingListIngredients}
        ingredientSections={shoppingListIngredientSections}
        servings={servings}
      />

      <CollectionSelectorSheet ref={collectionSheetRef} recipeId={recipe?.id} />

      <CookingReviewSheet
        ref={cookingReviewSheetRef}
        recipeName={recipe?.name}
        initialRating={displayedRating}
        isSubmitting={
          createCookingReviewMutation.isPending || isUploadingImages
        }
        onSubmit={handleSubmitReview}
      />

      <ReportContentSheet ref={reportSheetRef} />

      {isEditing && draft ? (
        <RecipePhotosSheet
          ref={recipePhotosSheetRef}
          photos={draftPhotoItems}
          onReorder={handleReorderImages}
          onRemove={handleRemoveImageById}
          onAddPhoto={handlePickRecipeImage}
          onCreateWithAI={handleGenerateRecipeImage}
          isCreatingWithAI={generateRecipeImageMutation.isPending}
        />
      ) : null}

      {isEditing && draft ? (
        <Animated.View
          entering={FadeIn.duration(180)}
          exiting={FadeOut.duration(120)}
          pointerEvents="box-none"
          style={[
            styles.actionBar,
            { paddingBottom: Math.max(insets.bottom - 14, 12) },
          ]}
          onLayout={(event) => {
            setEditFooterHeight(event.nativeEvent.layout.height);
          }}
        >
          {visibleDraftErrors.length > 0 ? (
            <Animated.View
              entering={FadeIn.duration(160)}
              exiting={FadeOut.duration(120)}
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              style={styles.validationSummary}
            >
              <Ionicons
                name="alert-circle"
                size={20}
                style={styles.validationSummaryIcon}
              />
              <View style={styles.validationSummaryContent}>
                <Text selectable style={styles.validationSummaryTitle}>
                  {visibleDraftErrors.length === 1
                    ? "1 thing needs attention"
                    : `${visibleDraftErrors.length} things need attention`}
                </Text>
                <Text selectable style={styles.validationSummaryText}>
                  {validationSummary}
                </Text>
              </View>
            </Animated.View>
          ) : null}

          <View style={styles.actionBarRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: isSaving, busy: isSaving }}
              style={({ pressed }) => [
                styles.primaryBarButton,
                (pressed || isSaving) && styles.primaryBarButtonPressed,
              ]}
              onPress={handleSaveDraft}
              disabled={isSaving}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="checkmark" size={20} color="white" />
              )}
              <Text style={styles.primaryBarButtonText}>
                {isCreateMode ? "Save recipe" : "Save changes"}
              </Text>
            </Pressable>
            {isImportReviewMode ? (
              <GlassSurface
                interactive
                style={styles.glassBarPill}
                contentStyle={styles.glassBarPillContent}
              >
                <Pressable
                  accessibilityRole="button"
                  onPress={handleDismissImportReview}
                  disabled={isSaving}
                  style={({ pressed }) => [
                    styles.glassBarTextButton,
                    pressed && styles.pressedFaded,
                  ]}
                >
                  <Text style={styles.glassBarText}>Dismiss</Text>
                </Pressable>
              </GlassSurface>
            ) : (
              <GlassSurface
                interactive
                style={styles.glassBarCircle}
                contentStyle={styles.glassBarPillContent}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    isCreateMode ? "Discard recipe" : "Cancel editing"
                  }
                  onPress={handleCancelEdit}
                  disabled={isSaving}
                  style={({ pressed }) => [
                    styles.glassBarIconButton,
                    pressed && styles.pressedFaded,
                  ]}
                >
                  <SystemIcon
                    sf="xmark"
                    android="close"
                    size={20}
                    color={styles.glassBarText.color}
                  />
                </Pressable>
              </GlassSurface>
            )}
          </View>
        </Animated.View>
      ) : showViewActionBar && recipe ? (
        <Animated.View
          entering={FadeIn.duration(180)}
          exiting={FadeOut.duration(120)}
          pointerEvents="box-none"
          style={[
            styles.actionBar,
            { paddingBottom: Math.max(insets.bottom - 14, 12) },
          ]}
          onLayout={(event) => {
            setEditFooterHeight(event.nativeEvent.layout.height);
          }}
        >
          <View style={styles.actionBarRow}>
            {isOwnRecipe ? (
              <Pressable
                accessibilityRole="button"
                onPress={handleStartCookMode}
                style={({ pressed }) => [
                  styles.primaryBarButton,
                  pressed && styles.primaryBarButtonPressed,
                ]}
              >
                <Ionicons name="play" size={18} color="white" />
                <Text style={styles.primaryBarButtonText}>Start cooking</Text>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Import recipe"
                accessibilityState={{
                  disabled: importMutation.isPending,
                  busy: importMutation.isPending,
                }}
                disabled={importMutation.isPending}
                onPress={handleImportRecipe}
                style={({ pressed }) => [
                  styles.primaryBarButton,
                  (pressed || importMutation.isPending) &&
                    styles.primaryBarButtonPressed,
                ]}
              >
                {importMutation.isPending ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <Ionicons name="download-outline" size={19} color="white" />
                )}
                <Text style={styles.primaryBarButtonText}>
                  {importMutation.isPending ? "Importing" : "Import recipe"}
                </Text>
              </Pressable>
            )}
            {isOwnRecipe ? (
              <GlassButtonGroup style={styles.glassBarGroup}>
                <GlassIconButton
                  accessibilityLabel="Add ingredients to shopping list"
                  onPress={handleOpenShoppingListSheet}
                >
                  <SystemIcon
                    sf="cart"
                    android="cart-outline"
                    color={styles.glassBarText.color}
                  />
                </GlassIconButton>
                <View style={styles.glassBarDivider} />
                <GlassIconButton
                  accessibilityLabel="Add to meal plan"
                  onPress={handleOpenMealPlanSheet}
                >
                  <SystemIcon
                    sf="calendar"
                    android="calendar-outline"
                    color={styles.glassBarText.color}
                  />
                </GlassIconButton>
              </GlassButtonGroup>
            ) : null}
          </View>
        </Animated.View>
      ) : null}

      <Modal
        visible={expandedStepImageUrl !== undefined}
        transparent
        animationType="fade"
        onRequestClose={() => setExpandedImageUrl(null)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setExpandedImageUrl(null)}
        >
          <View style={styles.modalContent}>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setExpandedImageUrl(null)}
            >
              <Ionicons name="close" size={32} color="#fff" />
            </TouchableOpacity>

            {expandedStepImageUrl && (
              <Image
                source={{ uri: expandedStepImageUrl }}
                style={styles.expandedImage}
                contentFit="contain"
              />
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create((theme) => ({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  androidHeaderMenuButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  androidHeaderMenuButtonPressed: {
    opacity: 0.55,
  },
  androidHeaderActions: {
    flexDirection: "row",
    alignItems: "center",
  },
  scrollView: {
    flex: 1,
  },
  centered: {
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  imageCarouselContainer: {
    height: IMAGE_HEIGHT,
  },
  imageContainer: {
    width: SCREEN_WIDTH,
    height: IMAGE_HEIGHT,
  },
  recipeImage: {
    width: "100%",
    height: "100%",
    backgroundColor: theme.colors.border,
  },
  imageUploadOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    alignItems: "center",
  },
  emptyHero: {
    flex: 1,
    backgroundColor: theme.colors.inputBackground,
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  emptyHeroIcon: {
    color: theme.colors.textSecondary,
  },
  emptyHeroText: {
    color: theme.colors.textSecondary,
    fontSize: 15,
    fontFamily: theme.fonts.semiBold,
  },
  validationMessage: {
    minHeight: 32,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.destructive + "32",
    backgroundColor: theme.colors.background,
    overflow: "hidden",
  },
  validationMessageTint: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: theme.colors.destructive + "12",
  },
  validationMessageIcon: {
    color: theme.colors.destructive,
  },
  validationMessageText: {
    flexShrink: 1,
    color: theme.colors.destructive,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: theme.fonts.semiBold,
  },
  centeredValidationMessage: {
    alignSelf: "center",
  },
  emptyHeroActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: 8,
    width: "100%",
    paddingHorizontal: 20,
  },
  emptyHeroButton: {
    flex: 1,
    maxWidth: 156,
    height: 38,
    paddingHorizontal: 14,
    borderRadius: 19,
    backgroundColor: theme.colors.background,
    borderWidth: 1,
    borderColor: theme.colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  emptyHeroButtonPrimary: {
    backgroundColor: theme.colors.primary,
    backgroundImage: theme.colors.primaryGradient,
    borderColor: theme.colors.primary,
  },
  emptyHeroButtonIcon: {
    color: theme.colors.text,
  },
  emptyHeroButtonText: {
    color: theme.colors.text,
    fontSize: 13,
    fontFamily: theme.fonts.semiBold,
  },
  emptyHeroButtonTextPrimary: {
    color: "white",
  },
  heroValidationMessage: {
    marginBottom: 8,
    borderColor: theme.colors.destructive + "32",
  },
  heroValidationMessageIcon: {
    color: theme.colors.destructive,
  },
  heroValidationMessageText: {
    color: theme.colors.destructive,
  },
  heroButtonDisabled: {
    opacity: 0.65,
  },
  whiteCard: {
    backgroundColor: theme.colors.background,
    paddingTop: 18,
    paddingBottom: 20,
    paddingHorizontal: 20,
    minHeight: 400,
  },
  tagsRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 4,
  },
  tagText: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    fontFamily: theme.fonts.bold,
  },
  tagEditor: {
    gap: 10,
    marginBottom: 4,
  },
  recipeDescription: {
    lineHeight: 22,
    fontFamily: theme.fonts.regular,
  },
  descriptionInput: {
    minHeight: 72,
    paddingHorizontal: 14,
    paddingTop: 11,
    paddingBottom: 11,
    borderRadius: 16,
    borderCurve: "continuous",
    backgroundColor: theme.colors.inputBackground,
    color: theme.colors.text,
    fontSize: 17,
    fontFamily: theme.fonts.regular,
    textAlignVertical: "top",
  },
  summaryPanel: {
    gap: 16,
  },
  summaryPanelEditing: {
    gap: 10,
  },
  metaEditor: {
    gap: 8,
  },
  metaInputError: {
    borderWidth: 1,
    borderColor: theme.colors.destructive,
    backgroundColor: theme.colors.destructive + "12",
  },
  metaIcon: {
    color: theme.colors.textSecondary,
  },
  nutritionCard: {
    padding: 14,
    borderRadius: 18,
    backgroundColor: theme.colors.inputBackground,
    gap: 12,
  },
  nutritionSubtitle: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontFamily: theme.fonts.medium,
  },
  nutritionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  nutritionMetric: {
    flexBasis: "22%",
    flexGrow: 1,
    padding: 12,
    borderRadius: 16,
    borderCurve: "continuous",
    backgroundColor: theme.colors.inputBackground,
    gap: 2,
  },
  nutritionMetricValue: {
    color: theme.colors.text,
    fontSize: 18,
    fontFamily: theme.fonts.black,
  },
  nutritionMetricLabel: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontFamily: theme.fonts.medium,
  },
  nutritionLoadingRow: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  nutritionRetryButton: {
    alignSelf: "flex-start",
    minHeight: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: theme.colors.primary,
    backgroundImage: theme.colors.primaryGradient,
    justifyContent: "center",
  },
  nutritionRetryText: {
    color: "white",
    fontSize: 13,
    fontFamily: theme.fonts.semiBold,
  },
  proBadge: {
    height: 24,
    paddingHorizontal: 9,
    borderRadius: 12,
    backgroundColor: theme.colors.primary + "20",
    alignItems: "center",
    justifyContent: "center",
  },
  proBadgeText: {
    color: theme.colors.primary,
    fontSize: 11,
    fontFamily: theme.fonts.semiBold,
  },
  ingredientItemSkeleton: {
    paddingVertical: 10,
  },
  skeletonTextBlock: {
    gap: 8,
    paddingVertical: 4,
  },
  tabContent: {
    paddingTop: 4,
  },
  contentSectionGroup: {
    paddingTop: 18,
  },
  sectionHeader: {
    paddingBottom: 2,
  },
  sectionTitle: {
    fontSize: 13,
    lineHeight: 18,
    color: theme.colors.textSecondary,
    fontFamily: theme.fonts.bold,
  },
  sectionHeadingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  sectionHeading: {
    fontSize: 23,
    lineHeight: 28,
    letterSpacing: -0.3,
    fontFamily: theme.fonts.black,
    color: theme.colors.text,
  },
  sectionSubheading: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    fontFamily: theme.fonts.medium,
  },
  unitsButton: {
    minHeight: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  unitsButtonText: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    fontFamily: theme.fonts.bold,
  },
  recipeSection: {
    gap: 8,
  },
  pageDivider: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginTop: 24,
    marginBottom: 24,
    opacity: 0.4,
  },
  ingredientItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  ingredientItemLast: {
    borderBottomWidth: 0,
  },
  ingredientQuantity: {
    width: 86,
    fontSize: 16,
    lineHeight: 22,
    fontFamily: theme.fonts.bold,
    color: theme.colors.text,
  },
  ingredientName: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    lineHeight: 22,
    color: theme.colors.text,
  },
  ingredientPreparation: {
    color: theme.colors.textSecondary,
  },
  instructionItem: {
    flexDirection: "row",
    gap: 12,
    paddingVertical: 9,
  },
  stepMarkerColumn: {
    width: 24,
    alignItems: "flex-start",
  },
  stepNumberBadge: {
    minWidth: 24,
    height: 24,
    justifyContent: "center",
    alignItems: "flex-start",
  },
  stepNumberBadgeEdit: {
    minWidth: 24,
    height: 27,
    justifyContent: "center",
    alignItems: "flex-start",
    marginTop: 10,
  },
  stepNumber: {
    fontSize: 19,
    lineHeight: 24,
    fontFamily: theme.fonts.black,
    color: theme.colors.primary,
  },
  instructionContent: {
    flex: 1,
    minWidth: 0,
  },
  instructionText: {
    fontSize: 16,
    lineHeight: 24,
    color: theme.colors.text,
  },
  stepImageThumbnail: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: 16,
    overflow: "hidden",
  },
  stepImage: {
    width: "100%",
    height: "100%",
  },
  editSectionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingBottom: 10,
  },
  editSectionInput: {
    flex: 1,
    minHeight: 50,
    paddingHorizontal: 20,
    paddingTop: 13,
    paddingBottom: 13,
    borderRadius: 25,
    backgroundColor: theme.colors.inputBackground,
    color: theme.colors.text,
    fontSize: 17,
    fontFamily: theme.fonts.semiBold,
    textAlignVertical: "top",
  },
  editIngredientRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingVertical: 5,
  },
  editIngredientInput: {
    flex: 1,
    minHeight: 50,
    paddingHorizontal: 20,
    paddingTop: 13,
    paddingBottom: 13,
    borderRadius: 25,
    backgroundColor: theme.colors.inputBackground,
    color: theme.colors.text,
    fontSize: 17,
    fontFamily: theme.fonts.regular,
    textAlignVertical: "top",
  },
  editInputError: {
    borderWidth: 1,
    borderColor: theme.colors.destructive,
    backgroundColor: theme.colors.destructive + "12",
  },
  editInstructionItem: {
    flexDirection: "row",
    gap: 10,
    paddingVertical: 8,
  },
  editInstructionInput: {
    minHeight: 104,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 25,
    backgroundColor: theme.colors.inputBackground,
    color: theme.colors.text,
    fontSize: 17,
    fontFamily: theme.fonts.regular,
    textAlignVertical: "top",
  },
  editStepImageWrap: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: 16,
    overflow: "hidden",
    marginTop: 10,
  },
  removeStepImageButton: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
  },
  editRemoveIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.inputBackground,
    marginTop: 6,
  },
  editIcon: {
    color: theme.colors.textSecondary,
  },
  inlineAddButton: {
    minHeight: 38,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    borderRadius: 19,
    marginTop: 8,
    backgroundColor: theme.colors.inputBackground,
  },
  inlineAddIcon: {
    color: theme.colors.primary,
  },
  inlineAddText: {
    color: theme.colors.primary,
    fontSize: 14,
    fontFamily: theme.fonts.semiBold,
  },
  addSectionButton: {
    minHeight: 42,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: 21,
    marginTop: 16,
    backgroundColor: theme.colors.primary + "12",
  },
  addSectionText: {
    color: theme.colors.primary,
    fontSize: 14,
    fontFamily: theme.fonts.semiBold,
  },
  validationSummary: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.destructive + "32",
    backgroundColor: theme.colors.destructive + "12",
  },
  validationSummaryIcon: {
    marginTop: 1,
    color: theme.colors.destructive,
  },
  validationSummaryContent: {
    flex: 1,
    gap: 1,
  },
  validationSummaryTitle: {
    color: theme.colors.destructive,
    fontSize: 14,
    lineHeight: 18,
    fontFamily: theme.fonts.bold,
  },
  validationSummaryText: {
    color: theme.colors.destructive,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: theme.fonts.medium,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.95)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  closeButton: {
    position: "absolute",
    top: 60,
    right: 20,
    zIndex: 10,
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  expandedImage: {
    width: "90%",
    height: "80%",
  },
  placeholderText: {
    color: theme.colors.placeholderText,
  },
  pressedFaded: {
    opacity: 0.6,
  },
  recipeTitle: {
    // Tucks the description up under the title so the two read as one
    // block; the gaps below them stay even.
    marginBottom: -10,
    fontSize: 31,
    lineHeight: 35,
    letterSpacing: -0.7,
    fontFamily: theme.fonts.black,
    color: theme.colors.text,
  },
  titleInput: {
    minHeight: 52,
    paddingHorizontal: 14,
    paddingTop: 9,
    paddingBottom: 9,
    borderRadius: 16,
    borderCurve: "continuous",
    backgroundColor: theme.colors.inputBackground,
    color: theme.colors.text,
    fontSize: 28,
    lineHeight: 33,
    letterSpacing: -0.7,
    fontFamily: theme.fonts.black,
  },
  attributionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: 16,
    rowGap: 6,
  },
  sourceLink: {
    minHeight: 24,
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  sourceLinkText: {
    flexShrink: 1,
    color: theme.colors.onPrimarySoft,
    fontSize: 14,
    fontFamily: theme.fonts.bold,
  },
  creatorLink: {
    minHeight: 24,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  creatorAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  creatorAvatarPlaceholder: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: theme.colors.inputBackground,
    justifyContent: "center",
    alignItems: "center",
  },
  creatorAvatarText: {
    color: theme.colors.textSecondary,
    fontSize: 10,
    fontFamily: theme.fonts.semiBold,
  },
  creatorText: {
    flexShrink: 1,
    color: theme.colors.textSecondary,
    fontSize: 14,
    fontFamily: theme.fonts.semiBold,
  },
  metaLine: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: 18,
    rowGap: 6,
  },
  metaLineItem: {
    minHeight: 22,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  metaLineText: {
    color: theme.colors.textSecondary,
    fontSize: 15,
    fontFamily: theme.fonts.medium,
  },
  metaLineValue: {
    color: theme.colors.text,
    fontFamily: theme.fonts.bold,
  },
  tagPill: {
    height: 28,
    paddingHorizontal: 11,
    borderRadius: 14,
    backgroundColor: theme.colors.inputBackground,
    justifyContent: "center",
  },
  metaWellRow: {
    flexDirection: "row",
    gap: 8,
  },
  metaWell: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
    borderRadius: 16,
    borderCurve: "continuous",
    backgroundColor: theme.colors.inputBackground,
  },
  metaWellLabel: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontFamily: theme.fonts.medium,
  },
  metaWellInput: {
    paddingVertical: 2,
    paddingHorizontal: 0,
    color: theme.colors.text,
    fontSize: 17,
    fontFamily: theme.fonts.bold,
  },
  photoStripWrap: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 16,
    alignItems: "center",
    gap: 8,
  },
  photoThumbImage: {
    width: "100%",
    height: "100%",
  },
  photoControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  photoPill: {
    height: 50,
    borderRadius: 25,
  },
  photoPillContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  photoPillButton: {
    height: 50,
    paddingLeft: 10,
    paddingRight: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  photoStack: {
    height: 34,
  },
  photoStackItem: {
    position: "absolute",
    top: 2,
    width: 30,
    height: 30,
    borderRadius: 9,
    borderCurve: "continuous",
    borderWidth: 2,
    borderColor: "white",
    overflow: "hidden",
    backgroundColor: theme.colors.inputBackground,
  },
  photoPillText: {
    color: "#191919",
    fontSize: 15,
    fontFamily: theme.fonts.bold,
  },
  photoPillChevron: {
    color: "rgba(0,0,0,0.5)",
  },
  photoAddCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  photoAddButton: {
    width: 50,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
  },
  photoStripButtonPressed: {
    opacity: 0.6,
  },
  photoStripIcon: {
    color: "#191919",
  },
  actionBar: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 0,
    gap: 10,
  },
  actionBarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  primaryBarButton: {
    flex: 1,
    height: 54,
    borderRadius: 27,
    borderCurve: "continuous",
    backgroundColor: theme.colors.primary,
    backgroundImage: theme.colors.primaryGradient,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    boxShadow: "0 8px 22px rgba(224, 0, 34, 0.3)",
  },
  primaryBarButtonPressed: {
    opacity: 0.8,
  },
  primaryBarButtonText: {
    color: "white",
    fontSize: 17,
    fontFamily: theme.fonts.bold,
  },
  glassBarGroup: {
    height: 54,
    borderRadius: 27,
    paddingHorizontal: 4,
  },
  glassBarDivider: {
    width: StyleSheet.hairlineWidth,
    height: 22,
    backgroundColor: theme.colors.border,
  },
  glassBarCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
  },
  glassBarPill: {
    height: 54,
    borderRadius: 27,
  },
  glassBarPillContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  glassBarIconButton: {
    width: 54,
    height: 54,
    justifyContent: "center",
    alignItems: "center",
  },
  glassBarTextButton: {
    height: 54,
    paddingHorizontal: 20,
    justifyContent: "center",
  },
  glassBarText: {
    color: theme.colors.text,
    fontSize: 16,
    fontFamily: theme.fonts.bold,
  },
  originalRecipeCard: {
    marginTop: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 18,
    borderCurve: "continuous",
    backgroundColor: theme.colors.inputBackground,
  },
  originalRecipeIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.background,
    justifyContent: "center",
    alignItems: "center",
  },
  originalRecipeIconGlyph: {
    color: theme.colors.text,
  },
  originalRecipeText: {
    flex: 1,
    minWidth: 0,
  },
  originalRecipeLabel: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    fontFamily: theme.fonts.medium,
  },
  originalRecipeName: {
    color: theme.colors.text,
    fontSize: 16,
    fontFamily: theme.fonts.bold,
  },
  deleteRecipeButton: {
    marginTop: 32,
    height: 52,
    borderRadius: 16,
    borderCurve: "continuous",
    backgroundColor: theme.colors.destructive + "17",
    justifyContent: "center",
    alignItems: "center",
  },
  deleteRecipeText: {
    color: theme.colors.destructive,
    fontSize: 16,
    fontFamily: theme.fonts.bold,
  },
}));
