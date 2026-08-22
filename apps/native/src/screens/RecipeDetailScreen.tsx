import {
  StackActions,
  useRoute,
  useNavigation,
  type RouteProp,
} from "@react-navigation/native";
import type { NativeStackHeaderItemProps } from "@react-navigation/native-stack";
import type { PublicImageAsset } from "@repo/contracts/images";
import { useTRPC } from "@repo/trpc/client";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
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
  ReportContentSheet,
  type ReportContentSheetRef,
} from "@/components/ReportContentSheet";
import {
  ShoppingListSelectorSheet,
  type ShoppingListSelectorSheetRef,
} from "@/components/ShoppingListSelectorSheet";
import { Skeleton } from "@/components/Skeleton";
import { VSpace } from "@/components/Space";
import { Text } from "@/components/Text";
import { PrimaryButton } from "@/components/buttons/PrimaryButton";
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
import { moveArrayItem } from "@/utils/reorder";
import { formatMinutesShort } from "@/utils/timeUtils";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const IMAGE_HEIGHT = SCREEN_WIDTH;

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
  const ingredientSectionYRef = useRef(0);
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

  const isOwnRecipe = recipe?.owner.id === userData?.user?.id;
  const displayedRating = ratingOverride ?? recipe?.userReviewRating ?? null;
  const recipeSourceUrl = recipe?.sourceUrl ?? null;
  const sourceWebsiteName = useMemo(
    () => getSourceWebsiteName(recipeSourceUrl),
    [recipeSourceUrl],
  );
  const sourceChipAccessibilityLabel = sourceWebsiteName
    ? `View on ${sourceWebsiteName}`
    : undefined;
  const shouldShowSourceChip =
    !isEditing &&
    !isPreviewMode &&
    Boolean(recipeSourceUrl && sourceWebsiteName);
  const shouldShowCreatorChip =
    !isEditing &&
    !isPreviewMode &&
    !isOwnRecipe &&
    !shouldShowSourceChip &&
    Boolean(recipe);
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
          : field === "servings"
            ? IMAGE_HEIGHT
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

  const handleOpenPersonaliseSheet = async () => {
    if (!recipe || isPreviewMode || isEditing) return;
    const allowed = await requireProFeature("Personalise recipe");
    if (!allowed) return;
    personaliseRecipeSheetRef.current?.present();
  };

  const handleOpenReviewSheet = () => {
    if (!recipe || !isOwnRecipe || isPreviewMode || isEditing) return;
    cookingReviewSheetRef.current?.present();
  };

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

  const handleRemoveCurrentImage = useCallback(() => {
    updateDraft((current) => {
      const nextImages = current.images.filter(
        (_, index) => index !== currentImageIndex,
      );
      return { ...current, images: nextImages };
    });
    setCurrentImageIndex((index) => Math.max(0, index - 1));
  }, [currentImageIndex, updateDraft]);

  const handleMoveCurrentImage = useCallback(
    (offset: -1 | 1) => {
      if (!draft) return;

      const nextIndex = currentImageIndex + offset;
      if (nextIndex < 0 || nextIndex >= draft.images.length) return;

      pendingImageScrollIndexRef.current = nextIndex;
      pendingImageScrollAnimatedRef.current = false;
      updateDraft((current) => ({
        ...current,
        images: moveArrayItem(current.images, currentImageIndex, nextIndex),
      }));
    },
    [currentImageIndex, draft, updateDraft],
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

  const handleOpenAndroidRecipeMenu = useCallback(() => {
    if (isOwnRecipe) {
      // Android alerts support at most three actions. The dialog remains
      // dismissible with the system back action or by tapping outside it.
      Alert.alert(
        "Recipe Options",
        undefined,
        [
          { text: "Edit Recipe", onPress: handleEnterEditMode },
          {
            text: "Manage Collections",
            onPress: () => collectionSheetRef.current?.present(),
          },
          {
            text: "Delete Recipe",
            style: "destructive",
            onPress: handleDeleteRecipe,
          },
        ],
        { cancelable: true },
      );
      return;
    }

    if (recipeId !== null) {
      Alert.alert("Recipe Options", undefined, [
        {
          text: "Report Recipe",
          onPress: () =>
            reportSheetRef.current?.present({
              targetType: "recipe",
              targetId: String(recipeId),
            }),
        },
        {
          text: "Block Recipe Author",
          style: "destructive",
          onPress: handleBlockRecipeOwner,
        },
        { text: "Cancel", style: "cancel" },
      ]);
    }
  }, [
    handleBlockRecipeOwner,
    handleDeleteRecipe,
    handleEnterEditMode,
    isOwnRecipe,
    recipeId,
  ]);

  useLayoutEffect(() => {
    const headerRightItems: any[] = [];

    if (!isEditing && !isPreviewMode && isOwnRecipe) {
      headerRightItems.push({
        type: "menu" as const,
        label: "Options",
        icon: {
          type: "sfSymbol" as const,
          name: "ellipsis",
        },
        menu: {
          items: [
            {
              type: "action" as const,
              label: "Edit Recipe",
              icon: {
                type: "sfSymbol" as const,
                name: "pencil",
              },
              onPress: handleEnterEditMode,
            },
            {
              type: "action" as const,
              label: "Manage Collections",
              icon: {
                type: "sfSymbol" as const,
                name: "bookmark",
              },
              onPress: () => {
                if (recipe) {
                  collectionSheetRef.current?.present();
                }
              },
            },
            {
              type: "action" as const,
              label: "Delete Recipe",
              icon: {
                type: "sfSymbol" as const,
                name: "trash",
              },
              destructive: true,
              onPress: handleDeleteRecipe,
            },
          ],
        },
      });
    } else if (!isEditing && !isPreviewMode && recipeId !== null) {
      headerRightItems.push({
        type: "menu" as const,
        label: "Safety options",
        icon: { type: "sfSymbol" as const, name: "ellipsis" },
        menu: {
          items: [
            {
              type: "action" as const,
              label: "Report Recipe",
              icon: { type: "sfSymbol" as const, name: "flag" },
              onPress: () =>
                reportSheetRef.current?.present({
                  targetType: "recipe",
                  targetId: String(recipeId),
                }),
            },
            {
              type: "action" as const,
              label: "Block Recipe Author",
              icon: { type: "sfSymbol" as const, name: "hand.raised" },
              destructive: true,
              onPress: handleBlockRecipeOwner,
            },
          ],
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
              <Pressable
                accessibilityLabel="Recipe options"
                accessibilityRole="button"
                hitSlop={8}
                onPress={handleOpenAndroidRecipeMenu}
                style={({ pressed }) => [
                  styles.androidHeaderMenuButton,
                  pressed && styles.androidHeaderMenuButtonPressed,
                ]}
              >
                <Ionicons
                  color={tintColor}
                  name="ellipsis-horizontal"
                  size={24}
                />
              </Pressable>
            )
          : undefined,
    });
  }, [
    handleBlockRecipeOwner,
    handleDeleteRecipe,
    handleEnterEditMode,
    handleOpenAndroidRecipeMenu,
    isEditing,
    isOwnRecipe,
    isPreviewMode,
    navigation,
    recipe,
    recipeId,
  ]);

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

  const renderImageEditOverlay = () => {
    if (!isEditing || !draft) return null;
    const isCreatingImage = generateRecipeImageMutation.isPending;

    return (
      <View style={styles.heroEditRow}>
        <TouchableOpacity
          style={styles.heroEditButton}
          onPress={handlePickRecipeImage}
          activeOpacity={0.78}
          accessibilityLabel="Add recipe image"
          accessibilityHint="Take a photo or choose one from your library"
          hitSlop={4}
        >
          <View style={styles.heroAddImageIcon}>
            <Ionicons name="images-outline" size={19} color="white" />
            <Ionicons
              name="add-circle"
              size={11}
              color="white"
              style={styles.heroAddImageBadge}
            />
          </View>
          <View style={styles.heroCountChip}>
            <Text style={styles.heroCountText}>{draft.images.length}</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.heroEditButton,
            isCreatingImage && styles.heroButtonDisabled,
          ]}
          onPress={handleGenerateRecipeImage}
          activeOpacity={0.78}
          disabled={isCreatingImage}
          accessibilityLabel="Create image with AI"
        >
          {isCreatingImage ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <Ionicons name="sparkles" size={17} color="white" />
          )}
          <Text numberOfLines={1} style={styles.heroEditButtonText}>
            AI
          </Text>
        </TouchableOpacity>
        {draft.images.length > 1 ? (
          <View style={styles.heroReorderControls}>
            <Pressable
              style={[
                styles.heroReorderButton,
                currentImageIndex === 0 && styles.heroButtonDisabled,
              ]}
              onPress={() => handleMoveCurrentImage(-1)}
              disabled={currentImageIndex === 0}
              accessibilityRole="button"
              accessibilityLabel="Move current photo earlier"
              accessibilityHint="Changes the photo order; the first photo is the recipe cover"
              accessibilityState={{ disabled: currentImageIndex === 0 }}
              hitSlop={4}
            >
              <Ionicons name="chevron-back" size={17} color="white" />
            </Pressable>
            <View style={styles.heroReorderDivider} />
            <Pressable
              style={[
                styles.heroReorderButton,
                currentImageIndex === draft.images.length - 1 &&
                  styles.heroButtonDisabled,
              ]}
              onPress={() => handleMoveCurrentImage(1)}
              disabled={currentImageIndex === draft.images.length - 1}
              accessibilityRole="button"
              accessibilityLabel="Move current photo later"
              accessibilityHint="Changes the photo order; the first photo is the recipe cover"
              accessibilityState={{
                disabled: currentImageIndex === draft.images.length - 1,
              }}
              hitSlop={4}
            >
              <Ionicons name="chevron-forward" size={17} color="white" />
            </Pressable>
          </View>
        ) : null}
        <TouchableOpacity
          style={styles.heroIconButton}
          onPress={handleRemoveCurrentImage}
          activeOpacity={0.78}
          accessibilityLabel="Remove current photo"
          hitSlop={4}
        >
          <Ionicons name="trash-outline" size={17} color="white" />
        </TouchableOpacity>
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
            <View pointerEvents="box-none" style={styles.imageOverlay}>
              <LinearGradient
                colors={["transparent", "rgba(0,0,0,0.58)"]}
                pointerEvents="none"
                style={[
                  styles.editImageGradient,
                  styles.emptyEditImageGradient,
                ]}
              />
              {renderValidationMessage("name")}
              <View
                style={[
                  styles.overlayTitleInputFrame,
                  hasVisibleDraftError("name") &&
                    styles.overlayTitleInputFrameError,
                ]}
              >
                <TextInput
                  defaultValue={draft.name}
                  onChangeText={(name) =>
                    updateDraft((current) => ({ ...current, name }))
                  }
                  placeholder="Recipe title"
                  placeholderTextColor="rgba(255,255,255,0.75)"
                  style={styles.overlayTitleInput}
                  multiline
                  textAlignVertical="top"
                />
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
          <PageIndicator
            currentPage={currentImageIndex + 1}
            totalPages={draft.images.length}
          />
          <View pointerEvents="box-none" style={styles.imageOverlay}>
            <LinearGradient
              colors={["transparent", "rgba(0,0,0,0.6)"]}
              pointerEvents="none"
              style={styles.editImageGradient}
            />
            {renderImageEditOverlay()}
            {renderValidationMessage("images", true, true)}
            {renderValidationMessage("name")}
            <View
              style={[
                styles.overlayTitleInputFrame,
                draft.images.length > 1 &&
                  styles.overlayTitleInputFrameWithCounter,
                hasVisibleDraftError("name") &&
                  styles.overlayTitleInputFrameError,
              ]}
            >
              <TextInput
                defaultValue={draft.name}
                onChangeText={(name) =>
                  updateDraft((current) => ({ ...current, name }))
                }
                placeholder="Recipe title"
                placeholderTextColor="rgba(255,255,255,0.75)"
                style={styles.overlayTitleInput}
                multiline
                textAlignVertical="top"
              />
            </View>
          </View>
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
            <LinearGradient
              colors={["transparent", "rgba(0,0,0,0.6)"]}
              pointerEvents="box-none"
              style={styles.imageOverlay}
            >
              <View pointerEvents="box-none" style={styles.heroTitleRow}>
                <View
                  pointerEvents="none"
                  style={[
                    styles.heroTitleTextWrap,
                    recipe.images.length > 1 &&
                      styles.heroTitleCounterClearance,
                  ]}
                >
                  <Text
                    type="title1"
                    style={styles.overlayTitle}
                    numberOfLines={2}
                  >
                    {recipe.name}
                  </Text>
                </View>
              </View>
              {shouldShowSourceChip || shouldShowCreatorChip ? (
                <View pointerEvents="box-none" style={styles.heroMetaRow}>
                  {shouldShowSourceChip && sourceWebsiteName ? (
                    <TouchableOpacity
                      style={[styles.heroMetaChip, styles.heroSourceButton]}
                      onPress={handleViewSource}
                      activeOpacity={0.76}
                      accessibilityLabel={sourceChipAccessibilityLabel}
                    >
                      <Ionicons
                        name="open-outline"
                        size={14}
                        style={styles.heroMetaIcon}
                      />
                      <Text style={styles.heroSourceText} numberOfLines={1}>
                        {sourceWebsiteName}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                  {shouldShowCreatorChip && ownerUsername ? (
                    <TouchableOpacity
                      style={[styles.heroMetaChip, styles.heroCreatorButton]}
                      onPress={() =>
                        navigation.navigate("UserProfile", {
                          userId: recipe.owner.id,
                        })
                      }
                      activeOpacity={0.76}
                      accessibilityLabel={`View ${ownerUsername}'s profile`}
                    >
                      {ownerAvatarUrl ? (
                        <Image
                          source={{ uri: ownerAvatarUrl }}
                          style={styles.heroCreatorAvatar}
                          contentFit="cover"
                        />
                      ) : (
                        <View style={styles.heroCreatorAvatarPlaceholder}>
                          <Text style={styles.heroCreatorAvatarText}>
                            {ownerUsername
                              .replace(/^@/, "")
                              .charAt(0)
                              .toUpperCase()}
                          </Text>
                        </View>
                      )}
                      <Text style={styles.heroCreatorText} numberOfLines={1}>
                        {ownerUsername}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}
            </LinearGradient>
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

            {section.ingredients.map((item) => {
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
                <View key={item.id} style={styles.ingredientItem}>
                  <View style={styles.ingredientContent}>
                    <Text style={styles.ingredientName}>
                      {(formattedQuantity || displayUnit) && (
                        <Text style={styles.ingredientQuantity}>
                          {formattedQuantity}
                          {formattedQuantity && displayUnit && needsSpace
                            ? " "
                            : ""}
                          {displayUnit}{" "}
                        </Text>
                      )}
                      {item.name}
                    </Text>
                    {item.preparation && (
                      <Text style={styles.ingredientPreparation}>
                        {item.preparation}
                      </Text>
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

  const renderEditableMeta = () => {
    if (!draft) return null;

    return (
      <View style={styles.metaEditor}>
        <View style={styles.recipeMetaGroup}>
          <View style={styles.recipeMetaInputItem}>
            <Ionicons name="leaf-outline" size={16} style={styles.metaIcon} />
            <Text style={styles.recipeMetaLabel}>Prep</Text>
            <TextInput
              defaultValue={draft.prepTime?.toString() ?? ""}
              onChangeText={(value) =>
                updateDraft((current) => ({
                  ...current,
                  prepTime: value ? Math.max(0, Number(value) || 0) : null,
                }))
              }
              placeholder="min"
              placeholderTextColor={styles.placeholderText.color}
              keyboardType="number-pad"
              style={styles.metaTextInput}
            />
          </View>
          <View style={styles.recipeMetaInputItem}>
            <Ionicons name="flame-outline" size={16} style={styles.metaIcon} />
            <Text style={styles.recipeMetaLabel}>Cook</Text>
            <TextInput
              defaultValue={draft.cookTime?.toString() ?? ""}
              onChangeText={(value) =>
                updateDraft((current) => ({
                  ...current,
                  cookTime: value ? Math.max(0, Number(value) || 0) : null,
                }))
              }
              placeholder="min"
              placeholderTextColor={styles.placeholderText.color}
              keyboardType="number-pad"
              style={styles.metaTextInput}
            />
          </View>
          <View
            style={[
              styles.recipeMetaInputItem,
              hasVisibleDraftError("servings") && styles.metaInputError,
            ]}
          >
            <Ionicons name="people-outline" size={16} style={styles.metaIcon} />
            <Text style={styles.recipeMetaLabel}>Serves</Text>
            <TextInput
              defaultValue={draft.servings.toString()}
              onChangeText={(value) =>
                updateDraft((current) => ({
                  ...current,
                  servings: value ? Number(value) || 0 : 0,
                }))
              }
              keyboardType="number-pad"
              style={styles.metaTextInput}
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
              <View>
                <Text style={styles.sectionHeading}>Nutrition</Text>
                <Text style={styles.sectionSubheading}>Per serving</Text>
              </View>
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
            <View>
              <Text style={styles.sectionHeading}>Nutrition</Text>
              <Text style={styles.sectionSubheading}>
                {nutritionSubheading}
              </Text>
            </View>
          </View>

          <View style={styles.nutritionCard}>
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
        <View style={styles.tagEditorHeader}>
          <Ionicons name="pricetag-outline" size={16} style={styles.tagsIcon} />
          <Text style={styles.tagEditorTitle}>Tags</Text>
        </View>
        <AutocompleteTagSelector
          selectedNames={draft.tagNames}
          onChange={updateDraftTags}
          placeholder="Search tags"
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
                <Skeleton width="88%" height={20} borderRadius={5} />
                <Skeleton width="62%" height={20} borderRadius={5} />

                <View style={styles.skeletonTagRow}>
                  <Skeleton width={82} height={16} borderRadius={4} />
                  <Skeleton width={64} height={16} borderRadius={4} />
                </View>

                <View style={styles.recipeMetaGroup}>
                  <Skeleton width={92} height={34} borderRadius={17} />
                  <Skeleton width={92} height={34} borderRadius={17} />
                  <Skeleton width={100} height={34} borderRadius={17} />
                </View>

                <Skeleton width={124} height={24} borderRadius={5} />
              </View>

              <View style={styles.recipeActionGroup}>
                <Skeleton width="60%" height={50} borderRadius={25} />
                <Skeleton width={50} height={50} borderRadius={25} />
                <Skeleton width={50} height={50} borderRadius={25} />
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
                style={styles.summaryPanel}
              >
                {isEditing && draft ? (
                  <TextInput
                    defaultValue={draft.description}
                    onChangeText={(description) =>
                      updateDraft((current) => ({ ...current, description }))
                    }
                    placeholder="Add a short description..."
                    placeholderTextColor={styles.placeholderText.color}
                    style={styles.descriptionInput}
                    multiline
                  />
                ) : recipe?.description ? (
                  <Text type="body" style={styles.recipeDescription}>
                    {recipe.description}
                  </Text>
                ) : null}

                {!isEditing && recipe?.tags && recipe.tags.length > 0 && (
                  <Animated.View
                    entering={FadeIn.duration(160)}
                    exiting={FadeOut.duration(120)}
                    layout={LinearTransition.duration(180)}
                    style={styles.tagsRow}
                  >
                    <Ionicons
                      name="pricetag-outline"
                      size={14}
                      style={styles.tagsIcon}
                    />
                    {recipe.tags.slice(0, 4).map((tag) => (
                      <Text key={tag.name} style={styles.tagText}>
                        {tag.name}
                      </Text>
                    ))}
                  </Animated.View>
                )}

                {isEditing && draft ? renderEditableTags() : null}

                {isEditing && draft ? (
                  renderEditableMeta()
                ) : (
                  <View style={styles.recipeMetaGroup}>
                    {recipe?.prepTime ? (
                      <View style={styles.recipeMetaItem}>
                        <Ionicons
                          name="leaf-outline"
                          size={16}
                          style={styles.metaIcon}
                        />
                        <Text style={styles.recipeMetaLabel}>Prep</Text>
                        <Text style={styles.recipeMetaValue}>
                          {formatMinutesShort(recipe.prepTime)}
                        </Text>
                      </View>
                    ) : null}
                    {recipe?.cookTime ? (
                      <View style={styles.recipeMetaItem}>
                        <Ionicons
                          name="flame-outline"
                          size={16}
                          style={styles.metaIcon}
                        />
                        <Text style={styles.recipeMetaLabel}>Cook</Text>
                        <Text style={styles.recipeMetaValue}>
                          {formatMinutesShort(recipe.cookTime)}
                        </Text>
                      </View>
                    ) : null}
                    {recipe ? (
                      <TouchableOpacity
                        style={styles.recipeMetaItem}
                        onPress={handleOpenAdjustSheet}
                        activeOpacity={0.76}
                        accessibilityLabel={`Adjust servings, currently ${servings}`}
                      >
                        <Ionicons
                          name="people-outline"
                          size={16}
                          style={styles.metaIcon}
                        />
                        <Text style={styles.recipeMetaLabel}>Serves</Text>
                        <Text style={styles.recipeMetaValue}>{servings}</Text>
                        <Ionicons
                          name="chevron-down"
                          size={13}
                          style={styles.recipeMetaButtonIcon}
                        />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                )}

                {!isEditing && isOwnRecipe && !isPreviewMode ? (
                  <Animated.View
                    entering={FadeIn.duration(160)}
                    exiting={FadeOut.duration(120)}
                    layout={LinearTransition.duration(180)}
                  >
                    <TouchableOpacity
                      style={styles.ratingInlineButton}
                      onPress={handleOpenReviewSheet}
                      activeOpacity={0.72}
                      accessibilityLabel={
                        displayedRating
                          ? `Rate recipe, current rating ${displayedRating} out of 5`
                          : "Rate recipe"
                      }
                    >
                      <Ionicons
                        name={displayedRating ? "star" : "star-outline"}
                        size={15}
                        style={
                          displayedRating
                            ? styles.starFilled
                            : styles.ratingIcon
                        }
                      />
                      <Text style={styles.ratingInlineText}>
                        {displayedRating
                          ? `Your rating ${displayedRating}/5`
                          : "Rate this recipe"}
                      </Text>
                      <Ionicons
                        name="chevron-forward"
                        size={13}
                        style={styles.ratingChevron}
                      />
                    </TouchableOpacity>
                  </Animated.View>
                ) : null}
              </Animated.View>

              {!isEditing && !isPreviewMode && (
                <Animated.View
                  entering={FadeIn.duration(180)}
                  exiting={FadeOut.duration(120)}
                  layout={LinearTransition.duration(200)}
                  style={styles.recipeActionGroup}
                >
                  {isOwnRecipe ? (
                    <>
                      <TouchableOpacity
                        style={styles.cookActionButton}
                        onPress={handleStartCookMode}
                        activeOpacity={0.82}
                      >
                        <Ionicons name="play" size={20} color="white" />
                        <Text style={styles.cookActionText}>Cook</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.recipeActionButton}
                        onPress={handleOpenPersonaliseSheet}
                        activeOpacity={0.78}
                        accessibilityLabel="Personalise recipe with AI"
                      >
                        <Ionicons
                          name="sparkles-outline"
                          size={21}
                          style={styles.recipeActionIcon}
                        />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.recipeActionButton}
                        onPress={handleOpenMealPlanSheet}
                        activeOpacity={0.78}
                        accessibilityLabel="Add to meal plan"
                      >
                        <Ionicons
                          name="calendar-outline"
                          size={21}
                          style={styles.recipeActionIcon}
                        />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.recipeActionButton}
                        onPress={handleOpenShoppingListSheet}
                        activeOpacity={0.78}
                        accessibilityLabel="Add ingredients to shopping list"
                      >
                        <Ionicons
                          name="cart-outline"
                          size={21}
                          style={styles.recipeActionIcon}
                        />
                      </TouchableOpacity>
                    </>
                  ) : (
                    <>
                      <TouchableOpacity
                        style={[
                          styles.communityActionButton,
                          styles.importActionButton,
                        ]}
                        onPress={handleImportRecipe}
                        disabled={importMutation.isPending}
                        activeOpacity={0.82}
                        accessibilityLabel="Import recipe"
                        accessibilityState={{
                          disabled: importMutation.isPending,
                          busy: importMutation.isPending,
                        }}
                      >
                        {importMutation.isPending ? (
                          <ActivityIndicator size="small" color="white" />
                        ) : (
                          <Ionicons
                            name="download-outline"
                            size={20}
                            color="white"
                          />
                        )}
                        <Text style={styles.cookActionText}>
                          {importMutation.isPending ? "Importing" : "Import"}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.communityActionButton,
                          styles.personaliseActionButton,
                        ]}
                        onPress={handleOpenPersonaliseSheet}
                        activeOpacity={0.82}
                        accessibilityLabel="Personalise recipe with AI"
                      >
                        <Ionicons
                          name="sparkles-outline"
                          size={20}
                          style={styles.recipeActionIcon}
                        />
                        <Text style={styles.personaliseActionText}>
                          Personalise
                        </Text>
                      </TouchableOpacity>
                    </>
                  )}
                </Animated.View>
              )}

              {!isEditing &&
                !isPreviewMode &&
                !isOwnRecipe &&
                !shouldShowCreatorChip &&
                recipe && (
                  <Animated.View
                    entering={FadeIn.duration(180)}
                    exiting={FadeOut.duration(120)}
                    layout={LinearTransition.duration(200)}
                    style={styles.actionRail}
                  >
                    <TouchableOpacity
                      style={styles.authorCompact}
                      onPress={() =>
                        navigation.navigate("UserProfile", {
                          userId: recipe.owner.id,
                        })
                      }
                      activeOpacity={0.7}
                    >
                      {ownerAvatarUrl ? (
                        <Image
                          source={{
                            uri: ownerAvatarUrl,
                          }}
                          style={styles.authorAvatarImage}
                        />
                      ) : (
                        <View style={styles.authorAvatarPlaceholder}>
                          <Text style={styles.authorAvatarText}>
                            {recipe.owner.name.charAt(0).toUpperCase()}
                          </Text>
                        </View>
                      )}
                      <View style={styles.authorInfo}>
                        <Text style={styles.authorLabel}>By</Text>
                        <Text style={styles.authorName} numberOfLines={1}>
                          {recipe.owner.name}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  </Animated.View>
                )}

              <View style={styles.pageDivider} />

              <View
                style={styles.recipeSection}
                onLayout={(event) => {
                  ingredientSectionYRef.current = event.nativeEvent.layout.y;
                }}
              >
                <View style={styles.sectionHeadingRow}>
                  <View>
                    <Text style={styles.sectionHeading}>Ingredients</Text>
                    <Text style={styles.sectionSubheading}>
                      {ingredientCount} items
                    </Text>
                  </View>
                </View>
                {isEditing ? renderValidationMessage("ingredients") : null}
                {isEditing ? renderEditableIngredients() : renderIngredients()}
              </View>

              <View style={styles.pageDivider} />

              <View style={styles.recipeSection}>
                <View style={styles.sectionHeadingRow}>
                  <View>
                    <Text style={styles.sectionHeading}>Method</Text>
                    <Text style={styles.sectionSubheading}>
                      {instructionCount} steps
                    </Text>
                  </View>
                </View>
                {isEditing ? renderEditableMethod() : renderMethod()}
              </View>

              {renderNutritionSection()}

              <VSpace
                size={
                  isEditing
                    ? visibleDraftErrors.length > 0
                      ? 190
                      : 120
                    : isPreviewMode || !isOwnRecipe
                      ? 100
                      : 40
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
        <Animated.View
          entering={FadeIn.duration(180)}
          exiting={FadeOut.duration(120)}
          style={[
            styles.stickyFooter,
            styles.editFooter,
            { paddingBottom: insets.bottom + 12 },
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

          <View style={styles.editFooterButtons}>
            {isImportReviewMode ? (
              <TouchableOpacity
                style={[styles.cancelButton, styles.dismissButton]}
                onPress={handleDismissImportReview}
                disabled={isSaving}
              >
                <Text
                  style={[styles.cancelButtonText, styles.dismissButtonText]}
                >
                  Dismiss
                </Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={handleCancelEdit}
                disabled={isSaving}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.saveButton, isSaving && styles.buttonDisabled]}
              onPress={handleSaveDraft}
              disabled={isSaving}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons
                    name="checkmark"
                    size={20}
                    style={styles.saveButtonIcon}
                  />
                  <Text style={styles.saveButtonText}>Save</Text>
                </>
              )}
            </TouchableOpacity>
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
  imageOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 70,
    paddingBottom: 20,
    paddingHorizontal: 20,
  },
  editImageGradient: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 180,
  },
  emptyEditImageGradient: {
    height: 130,
  },
  overlayTitle: {
    color: "white",
  },
  heroTitleRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    width: "100%",
  },
  heroTitleTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  heroTitleCounterClearance: {
    paddingRight: 64,
  },
  heroMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    width: "100%",
  },
  heroMetaChip: {
    minHeight: 30,
    paddingHorizontal: 10,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.24)",
    backgroundColor: "rgba(0,0,0,0.38)",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  heroSourceButton: {
    maxWidth: "72%",
    flexShrink: 1,
  },
  heroMetaIcon: {
    color: "rgba(255,255,255,0.84)",
  },
  heroSourceText: {
    flexShrink: 1,
    minWidth: 0,
    maxWidth: 180,
    color: "rgba(255,255,255,0.88)",
    fontSize: 13,
    fontFamily: theme.fonts.semiBold,
  },
  heroCreatorButton: {
    maxWidth: "72%",
    flexShrink: 1,
    paddingLeft: 4,
    paddingRight: 10,
    gap: 7,
  },
  heroCreatorAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.32)",
  },
  heroCreatorAvatarPlaceholder: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  heroCreatorAvatarText: {
    color: "white",
    fontSize: 10,
    lineHeight: 13,
    fontFamily: theme.fonts.semiBold,
    includeFontPadding: false,
  },
  heroCreatorText: {
    flexShrink: 1,
    minWidth: 0,
    color: "rgba(255,255,255,0.92)",
    fontSize: 13,
    fontFamily: theme.fonts.semiBold,
  },
  overlayTitleInputFrame: {
    marginTop: -5,
    marginBottom: -9,
    marginHorizontal: -13,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.42)",
    backgroundColor: "rgba(0,0,0,0.14)",
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  overlayTitleInputFrameError: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: theme.colors.destructive,
    backgroundColor: "rgba(0,0,0,0.14)",
  },
  overlayTitleInputFrameWithCounter: {
    marginRight: 58,
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
  overlayTitleInput: {
    minHeight: 38,
    maxHeight: 72,
    color: "white",
    fontSize: 28,
    lineHeight: 34,
    fontFamily: theme.fonts.black,
    letterSpacing: -1,
    paddingTop: 0,
    paddingBottom: 4,
    paddingHorizontal: 0,
    backgroundColor: "transparent",
  },
  heroEditRow: {
    width: "100%",
    flexDirection: "row",
    flexWrap: "nowrap",
    alignItems: "center",
    gap: 6,
    marginBottom: 10,
  },
  heroEditButton: {
    minWidth: 0,
    height: 36,
    paddingHorizontal: 8,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.45)",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  heroButtonDisabled: {
    opacity: 0.65,
  },
  heroAddImageIcon: {
    width: 21,
    height: 21,
    justifyContent: "center",
    alignItems: "center",
  },
  heroAddImageBadge: {
    position: "absolute",
    right: -2,
    bottom: -1,
  },
  heroEditButtonText: {
    flexShrink: 1,
    color: "white",
    fontSize: 13,
    fontFamily: theme.fonts.semiBold,
  },
  heroCountChip: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 0,
    borderRadius: 9,
    backgroundColor: "rgba(255,255,255,0.16)",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 2,
  },
  heroCountText: {
    color: "white",
    fontSize: 11,
    lineHeight: 18,
    fontFamily: theme.fonts.semiBold,
    includeFontPadding: false,
  },
  heroIconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
  },
  heroReorderControls: {
    height: 36,
    borderRadius: 18,
    borderCurve: "continuous",
    backgroundColor: "rgba(0,0,0,0.45)",
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
  },
  heroReorderButton: {
    width: 38,
    height: 36,
    justifyContent: "center",
    alignItems: "center",
  },
  heroReorderDivider: {
    width: StyleSheet.hairlineWidth,
    height: 18,
    backgroundColor: "rgba(255,255,255,0.24)",
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
    gap: 8,
  },
  tagText: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    fontFamily: theme.fonts.semiBold,
  },
  tagsIcon: {
    color: theme.colors.textSecondary,
  },
  tagEditor: {
    gap: 10,
    marginBottom: 4,
  },
  tagEditorHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  tagEditorTitle: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    fontFamily: theme.fonts.semiBold,
  },
  recipeDescription: {
    lineHeight: 22,
    fontFamily: theme.fonts.regular,
  },
  descriptionInput: {
    minHeight: 96,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 25,
    backgroundColor: theme.colors.inputBackground,
    color: theme.colors.text,
    fontSize: 17,
    fontFamily: theme.fonts.regular,
    textAlignVertical: "top",
  },
  summaryPanel: {
    gap: 14,
  },
  recipeMetaGroup: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  metaEditor: {
    gap: 8,
  },
  recipeMetaItem: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    borderRadius: 17,
    backgroundColor: theme.colors.inputBackground,
  },
  recipeMetaInputItem: {
    height: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    borderRadius: 17,
    backgroundColor: theme.colors.inputBackground,
  },
  metaInputError: {
    borderWidth: 1,
    borderColor: theme.colors.destructive,
    backgroundColor: theme.colors.destructive + "12",
  },
  recipeMetaButtonIcon: {
    marginLeft: -1,
    color: theme.colors.textSecondary,
  },
  recipeMetaLabel: {
    fontSize: 12,
    lineHeight: 16,
    color: theme.colors.textSecondary,
    fontFamily: theme.fonts.semiBold,
    includeFontPadding: false,
  },
  recipeMetaValue: {
    fontSize: 12,
    lineHeight: 16,
    color: theme.colors.text,
    fontFamily: theme.fonts.semiBold,
    includeFontPadding: false,
  },
  metaTextInput: {
    height: 16,
    width: 28,
    paddingHorizontal: 0,
    paddingVertical: 0,
    color: theme.colors.text,
    fontSize: 12,
    fontFamily: theme.fonts.semiBold,
    includeFontPadding: false,
  },
  ratingInlineButton: {
    alignSelf: "flex-start",
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  ratingIcon: {
    color: theme.colors.textSecondary,
  },
  ratingInlineText: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    fontFamily: theme.fonts.semiBold,
  },
  ratingChevron: {
    color: theme.colors.textSecondary,
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
    minWidth: 78,
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: theme.colors.background,
    gap: 2,
  },
  nutritionMetricValue: {
    color: theme.colors.text,
    fontSize: 15,
    fontFamily: theme.fonts.semiBold,
  },
  nutritionMetricLabel: {
    color: theme.colors.textSecondary,
    fontSize: 11,
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
  starFilled: {
    color: theme.colors.primary,
  },
  ingredientItemSkeleton: {
    paddingVertical: 10,
  },
  skeletonTagRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  recipeActionGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingTop: 14,
  },
  actionRail: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingTop: 12,
  },
  cookActionButton: {
    flex: 1,
    minHeight: 50,
    borderRadius: 25,
    backgroundColor: theme.colors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  communityActionButton: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minHeight: 50,
    borderRadius: 25,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  importActionButton: {
    backgroundColor: theme.colors.primary,
  },
  personaliseActionButton: {
    backgroundColor: theme.colors.inputBackground,
  },
  personaliseActionText: {
    color: theme.colors.text,
    fontSize: 17,
    fontFamily: theme.fonts.semiBold,
  },
  cookActionText: {
    color: "white",
    fontSize: 17,
    fontFamily: theme.fonts.semiBold,
  },
  recipeActionButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: theme.colors.inputBackground,
    justifyContent: "center",
    alignItems: "center",
  },
  recipeActionIcon: {
    color: theme.colors.text,
  },
  authorAvatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
    flexShrink: 0,
  },
  authorAvatarPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.primary,
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
  },
  authorAvatarText: {
    fontSize: 15,
    fontFamily: theme.fonts.semiBold,
    color: theme.colors.buttonText,
  },
  authorInfo: {
    flex: 1,
    minWidth: 0,
  },
  authorCompact: {
    flex: 1,
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    borderRadius: 25,
    backgroundColor: theme.colors.inputBackground,
  },
  authorLabel: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    fontFamily: theme.fonts.semiBold,
    textTransform: "uppercase",
  },
  authorName: {
    fontSize: 15,
    color: theme.colors.text,
    fontFamily: theme.fonts.semiBold,
  },
  tabContent: {
    paddingTop: 16,
  },
  contentSectionGroup: {
    paddingTop: 18,
  },
  sectionHeader: {
    paddingBottom: 10,
  },
  sectionTitle: {
    fontSize: 17,
    lineHeight: 22,
    color: theme.colors.text,
    fontFamily: theme.fonts.bold,
  },
  sectionHeadingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingBottom: 2,
  },
  sectionHeading: {
    fontSize: 22,
    fontFamily: theme.fonts.bold,
    color: theme.colors.text,
  },
  sectionSubheading: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    fontFamily: theme.fonts.semiBold,
    marginTop: 2,
  },
  recipeSection: {
    gap: 8,
  },
  pageDivider: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginTop: 30,
    marginBottom: 24,
    opacity: 0.4,
  },
  ingredientItem: {
    paddingVertical: 10,
  },
  ingredientContent: {
    flex: 1,
  },
  ingredientQuantity: {
    fontFamily: theme.fonts.bold,
    color: theme.colors.text,
  },
  ingredientName: {
    fontSize: 17,
    color: theme.colors.text,
  },
  ingredientPreparation: {
    fontSize: 14,
    fontStyle: "italic",
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
  instructionItem: {
    flexDirection: "row",
    gap: 12,
    paddingVertical: 16,
  },
  stepMarkerColumn: {
    width: 30,
    alignItems: "center",
  },
  stepNumberBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.colors.inputBackground,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 0,
  },
  stepNumberBadgeEdit: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.colors.inputBackground,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 8,
  },
  stepNumber: {
    fontSize: 13,
    lineHeight: 17,
    fontFamily: theme.fonts.bold,
    color: theme.colors.primary,
  },
  instructionContent: {
    flex: 1,
    minWidth: 0,
  },
  instructionText: {
    fontSize: 17,
    lineHeight: 27,
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
  stickyFooter: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: theme.colors.background,
    paddingTop: 12,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  editFooter: {
    gap: 10,
  },
  editFooterButtons: {
    flexDirection: "row",
    gap: 12,
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
  cancelButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 50,
    backgroundColor: theme.colors.inputBackground,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  cancelButtonText: {
    color: theme.colors.text,
    fontSize: 17,
    fontFamily: theme.fonts.semiBold,
  },
  dismissButton: {
    borderColor: theme.colors.destructive,
    backgroundColor: theme.colors.destructive + "12",
  },
  dismissButtonText: {
    color: theme.colors.destructive,
  },
  saveButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 50,
    backgroundColor: theme.colors.primary,
    borderRadius: 25,
  },
  buttonDisabled: {
    opacity: 0.62,
  },
  saveButtonIcon: {
    color: theme.colors.buttonText,
  },
  saveButtonText: {
    color: theme.colors.buttonText,
    fontSize: 17,
    fontFamily: theme.fonts.semiBold,
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
}));
