import { useTRPC, type Outputs } from "@repo/trpc/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { AppState, type AppStateStatus } from "react-native";

import type { ParsedRecipe } from "@/api/recipe";
import { reportApiError } from "@/lib/apiErrorAlert";
import { resolvePublicError } from "@/lib/publicError";
import { useSessionContext } from "@/lib/sessionContext";

export type BackgroundImportMode = "url" | "text" | "image";
export type BackgroundImportType = "basic" | "smart";
export type BackgroundImportStatus =
  | "pending"
  | "processing"
  | "ready"
  | "failed";

export interface LocalBackgroundImportTask {
  id: string;
  mode: BackgroundImportMode;
  title: string;
  run: () => Promise<ParsedRecipe>;
}

export interface ServerBackgroundImportTask {
  id: string;
  importType: BackgroundImportType;
  mode: BackgroundImportMode;
  title: string;
  data: string;
  mimeType?: "image/jpeg" | "image/png" | "image/webp";
}

export type BackgroundImportTask =
  | LocalBackgroundImportTask
  | ServerBackgroundImportTask;

export interface BackgroundImport {
  id: string;
  importType?: BackgroundImportType;
  mode: BackgroundImportMode;
  title: string;
  status: BackgroundImportStatus;
  recipe?: ParsedRecipe;
  error?: string;
  errorCode?: string;
}

interface BackgroundImportQueueContextValue {
  imports: BackgroundImport[];
  pendingCount: number;
  readyCount: number;
  startImport: (task: BackgroundImportTask) => void;
  dismissImport: (id: string) => void;
}

const BackgroundImportQueueContext =
  createContext<BackgroundImportQueueContextValue | null>(null);

type RecipeImportJob = Outputs["recipe"]["listImportJobs"][number];

const mapImportJobToImport = (job: RecipeImportJob): BackgroundImport => ({
  id: job.id,
  importType: job.importType as BackgroundImportType,
  mode: job.mode as BackgroundImportMode,
  title: job.title,
  status: job.status as BackgroundImportStatus,
  recipe: job.recipe?.success ? job.recipe : undefined,
  ...(job.errorCode && { errorCode: job.errorCode }),
  error: job.errorCode
    ? resolvePublicError(
        { data: { appCode: job.errorCode } },
        "Something went wrong while importing.",
      ).message
    : (job.error ?? undefined),
});

export function BackgroundImportQueueProvider({ children }: PropsWithChildren) {
  const session = useSessionContext();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const userId = session?.user.id ?? null;
  const enabled = Boolean(userId);
  const [localImports, setLocalImports] = useState<BackgroundImport[]>([]);
  const [dismissedImportIds, setDismissedImportIds] = useState<Set<string>>(
    () => new Set(),
  );
  const completedSmartImportIdsRef = useRef<Set<string>>(new Set());

  const importJobsQuery = useQuery({
    ...trpc.recipe.listImportJobs.queryOptions(),
    enabled,
    refetchInterval: (query) => {
      const jobs = query.state.data;
      return jobs?.some(
        (job) => job.status === "pending" || job.status === "processing",
      )
        ? 2500
        : false;
    },
  });
  const importJobs = useMemo(
    () => (enabled ? (importJobsQuery.data ?? []) : []),
    [enabled, importJobsQuery.data],
  );

  const createImportJob = useMutation({
    ...trpc.recipe.createImportJob.mutationOptions(),
    onSettled: () => {
      queryClient.invalidateQueries(trpc.recipe.listImportJobs.pathFilter());
      queryClient.invalidateQueries(trpc.subscription.getStatus.pathFilter());
    },
  });

  const dismissImportJob = useMutation({
    ...trpc.recipe.dismissImportJob.mutationOptions(),
    onSettled: () => {
      queryClient.invalidateQueries(trpc.recipe.listImportJobs.pathFilter());
    },
  });

  useEffect(() => {
    setLocalImports([]);
    setDismissedImportIds(new Set());
    completedSmartImportIdsRef.current = new Set();
  }, [userId]);

  useEffect(() => {
    const subscription = AppState.addEventListener(
      "change",
      (state: AppStateStatus) => {
        if (state === "active" && enabled) {
          importJobsQuery.refetch().catch(() => {});
        }
      },
    );

    return () => {
      subscription.remove();
    };
  }, [enabled, importJobsQuery]);

  useEffect(() => {
    if (importJobs.length === 0) return;

    const serverImportIds = new Set(importJobs.map((job) => job.id));
    setLocalImports((current) =>
      current.filter((item) => !serverImportIds.has(item.id)),
    );
  }, [importJobs]);

  useEffect(() => {
    const hasNewCompletedSmartImport = importJobs.some((job) => {
      if (
        job.importType !== "smart" ||
        job.status === "pending" ||
        job.status === "processing"
      )
        return false;
      if (completedSmartImportIdsRef.current.has(job.id)) return false;
      completedSmartImportIdsRef.current.add(job.id);
      return true;
    });

    if (hasNewCompletedSmartImport) {
      queryClient.invalidateQueries(trpc.subscription.getStatus.pathFilter());
    }
  }, [importJobs, queryClient, trpc]);

  const serverImports = useMemo(
    () =>
      importJobs
        .filter((job) => !dismissedImportIds.has(job.id))
        .map(mapImportJobToImport),
    [dismissedImportIds, importJobs],
  );

  const imports = useMemo(() => {
    const serverImportIds = new Set(serverImports.map((item) => item.id));
    return [
      ...serverImports,
      ...localImports.filter((item) => !serverImportIds.has(item.id)),
    ];
  }, [localImports, serverImports]);

  const startImport = useCallback(
    (task: BackgroundImportTask) => {
      setLocalImports((current) => [
        {
          id: task.id,
          importType: "importType" in task ? task.importType : "smart",
          mode: task.mode,
          title: task.title,
          status: "pending",
        },
        ...current.filter((item) => item.id !== task.id),
      ]);

      if (!("run" in task)) {
        createImportJob.mutate(task, {
          onError: (err) => {
            const publicError = reportApiError(err, {
              operation: "recipe.createImportJob",
              fallback: "Something went wrong while importing.",
            });
            setLocalImports((current) =>
              current.map((item) =>
                item.id === task.id
                  ? {
                      ...item,
                      status: "failed",
                      error: publicError.message,
                      errorCode: publicError.code,
                    }
                  : item,
              ),
            );
          },
        });
        return;
      }

      task
        .run()
        .then((recipe) => {
          setLocalImports((current) =>
            current.map((item) =>
              item.id === task.id
                ? {
                    ...item,
                    status: "ready",
                    title: recipe.data.name,
                    recipe,
                  }
                : item,
            ),
          );
        })
        .catch((err: unknown) => {
          const publicError = reportApiError(err, {
            operation: "recipe.import",
            fallback: "Something went wrong while importing.",
          });
          setLocalImports((current) =>
            current.map((item) =>
              item.id === task.id
                ? {
                    ...item,
                    status: "failed",
                    error: publicError.message,
                    errorCode: publicError.code,
                  }
                : item,
            ),
          );
        });
    },
    [createImportJob],
  );

  const dismissImport = useCallback(
    (id: string) => {
      setLocalImports((current) => current.filter((item) => item.id !== id));
      setDismissedImportIds((current) => new Set(current).add(id));
      dismissImportJob.mutate({ id });
    },
    [dismissImportJob],
  );

  const value = useMemo(
    () => ({
      imports,
      pendingCount: imports.filter(
        (item) => item.status === "pending" || item.status === "processing",
      ).length,
      readyCount: imports.filter((item) => item.status === "ready").length,
      startImport,
      dismissImport,
    }),
    [dismissImport, imports, startImport],
  );

  return (
    <BackgroundImportQueueContext.Provider value={value}>
      {children}
    </BackgroundImportQueueContext.Provider>
  );
}

export function useBackgroundImportQueue() {
  const context = useContext(BackgroundImportQueueContext);
  if (!context) {
    throw new Error(
      "useBackgroundImportQueue must be used within BackgroundImportQueueProvider",
    );
  }
  return context;
}

export function createBackgroundImportId(mode: BackgroundImportMode) {
  return `${mode}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
