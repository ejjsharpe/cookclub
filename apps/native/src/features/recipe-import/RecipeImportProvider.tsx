import type {
  RecipeImportMode,
  RecipeImportStatus,
  RecipeImportType,
} from "@repo/contracts/recipe-import";
import { useTRPC, type Outputs } from "@repo/trpc/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type PropsWithChildren,
} from "react";
import { AppState, type AppStateStatus } from "react-native";

import { useImageUpload } from "@/hooks/useImageUpload";
import { reportApiError } from "@/lib/apiErrorAlert";
import { resolvePublicError } from "@/lib/publicError";
import { useSessionContext } from "@/lib/sessionContext";

export type RecipeImportSummary = Outputs["recipeImport"]["list"][number];

export type RecipeImportSubmission =
  | {
      id: string;
      importType: "basic";
      source: { type: "url"; value: string };
    }
  | {
      id: string;
      importType: "smart";
      source:
        | { type: "url" | "text"; value: string }
        | { type: "image"; uploadKeys: string[] };
    };

export type RecipeImportItem = Omit<
  RecipeImportSummary,
  "error" | "importType" | "mode" | "status"
> & {
  importType: RecipeImportType;
  mode: RecipeImportMode;
  status: RecipeImportStatus;
  error?: string;
};

type RecipeImportContextValue = {
  imports: RecipeImportItem[];
  pendingCount: number;
  readyCount: number;
  submitImport: (
    submission: RecipeImportSubmission,
  ) => Promise<RecipeImportSummary>;
  uploadImportSource: (fileUri: string, maxBytes?: number) => Promise<string>;
  dismissImport: (id: string) => Promise<void>;
};

const RecipeImportContext = createContext<RecipeImportContextValue | null>(
  null,
);

export function createRecipeImportId() {
  return Crypto.randomUUID();
}

export function RecipeImportProvider({ children }: PropsWithChildren) {
  const session = useSessionContext();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const enabled = Boolean(session?.user.id);
  const { uploadImages } = useImageUpload({ maxConcurrent: 3 });

  const jobsQuery = useQuery({
    ...trpc.recipeImport.list.queryOptions(),
    enabled,
    refetchInterval: (query) =>
      query.state.data?.some(
        (job) => job.status === "pending" || job.status === "processing",
      )
        ? 1000
        : false,
  });

  const createMutation = useMutation({
    ...trpc.recipeImport.create.mutationOptions(),
    onSuccess: (_job, variables) => {
      queryClient.invalidateQueries(trpc.recipeImport.list.pathFilter());
      if (variables.importType === "smart") {
        queryClient.invalidateQueries(trpc.subscription.getStatus.pathFilter());
      }
    },
  });
  const dismissMutation = useMutation(
    trpc.recipeImport.dismiss.mutationOptions({
      onMutate: async ({ id }) => {
        const listFilter = trpc.recipeImport.list.pathFilter();
        await queryClient.cancelQueries(listFilter);

        const previousLists =
          queryClient.getQueriesData<RecipeImportSummary[]>(listFilter);
        queryClient.setQueriesData<RecipeImportSummary[]>(
          listFilter,
          (current) => current?.filter((job) => job.id !== id),
        );

        return { previousLists };
      },
      onError: (_error, _variables, context) => {
        for (const [queryKey, data] of context?.previousLists ?? []) {
          queryClient.setQueryData(queryKey, data);
        }
      },
      onSuccess: (_data, { id }) => {
        queryClient.setQueriesData<RecipeImportSummary[]>(
          trpc.recipeImport.list.pathFilter(),
          (current) => current?.filter((job) => job.id !== id),
        );
        queryClient.removeQueries({
          queryKey: trpc.recipeImport.get.queryKey({ id }),
          exact: true,
        });
      },
    }),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener(
      "change",
      (state: AppStateStatus) => {
        if (state === "active" && enabled) {
          jobsQuery.refetch().catch(() => {});
        }
      },
    );
    return () => subscription.remove();
  }, [enabled, jobsQuery]);

  const uploadImportSource = useCallback(
    async (fileUri: string, maxBytes?: number) => {
      const [upload] = await uploadImages(
        [fileUri],
        "recipe_import_source",
        maxBytes,
      );
      const uploadKey = upload?.key;
      if (!uploadKey)
        throw new Error("The recipe image could not be uploaded.");
      return uploadKey;
    },
    [uploadImages],
  );

  const submitImport = useCallback(
    async (submission: RecipeImportSubmission) => {
      try {
        if (submission.source.type === "image") {
          if (!submission.source.uploadKeys.length) {
            throw new Error(
              "One or more completed image uploads are required.",
            );
          }
          return await createMutation.mutateAsync({
            id: submission.id,
            importType: "smart",
            source: submission.source,
          });
        }

        if (submission.importType === "basic") {
          return await createMutation.mutateAsync({
            id: submission.id,
            importType: "basic",
            source: submission.source,
          });
        }
        return await createMutation.mutateAsync({
          id: submission.id,
          importType: "smart",
          source: submission.source,
        });
      } catch (error) {
        reportApiError(error, {
          operation: "recipeImport.create",
          fallback: "Something went wrong while starting the import.",
        });
        throw error;
      }
    },
    [createMutation],
  );

  const dismissImport = useCallback(
    async (id: string) => {
      await dismissMutation.mutateAsync({ id });
    },
    [dismissMutation],
  );

  const imports = useMemo<RecipeImportItem[]>(
    () =>
      (enabled ? (jobsQuery.data ?? []) : []).map((job) => {
        const { error: storedError, ...summary } = job;
        return {
          ...summary,
          importType: job.importType as RecipeImportType,
          mode: job.mode as RecipeImportMode,
          status: job.status as RecipeImportStatus,
          ...(job.errorCode
            ? {
                error: resolvePublicError(
                  { data: { appCode: job.errorCode } },
                  "Something went wrong while importing.",
                ).message,
              }
            : storedError
              ? { error: storedError }
              : {}),
        };
      }),
    [enabled, jobsQuery.data],
  );

  const value = useMemo<RecipeImportContextValue>(
    () => ({
      imports,
      pendingCount: imports.filter(
        (job) => job.status === "pending" || job.status === "processing",
      ).length,
      readyCount: imports.filter((job) => job.status === "ready").length,
      submitImport,
      uploadImportSource,
      dismissImport,
    }),
    [dismissImport, imports, submitImport, uploadImportSource],
  );

  return (
    <RecipeImportContext.Provider value={value}>
      {children}
    </RecipeImportContext.Provider>
  );
}

export function useRecipeImport() {
  const value = useContext(RecipeImportContext);
  if (!value) {
    throw new Error("useRecipeImport must be used within RecipeImportProvider");
  }
  return value;
}
