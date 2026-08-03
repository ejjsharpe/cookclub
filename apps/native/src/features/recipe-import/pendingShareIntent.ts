import {
  RECIPE_IMPORT_LIMITS,
  type RecipeImportType,
} from "@repo/contracts/recipe-import";
import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";

import { storage } from "@/lib/mmkv";

const STORAGE_KEY = "recipe_import_pending_share_v2";
const RECORD_VERSION = 2 as const;
const importDirectory = new Directory(Paths.document, "recipe-import");

type PendingShareBase = {
  version: typeof RECORD_VERSION;
  id: string;
  importType?: RecipeImportType;
  createdAt: number;
};

export type PendingShareIntent =
  | (PendingShareBase & { type: "url" | "text"; value: string })
  | (PendingShareBase & {
      type: "image";
      fileUri: string;
      mimeType: "image/jpeg" | "image/png" | "image/webp";
      uploadKey?: string;
    });

type DetectedShareIntent = {
  type: "url" | "text" | "image";
  content: string;
  mimeType?: string;
};

function isPendingShareIntent(value: unknown): value is PendingShareIntent {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<PendingShareIntent>;
  if (
    record.version !== RECORD_VERSION ||
    typeof record.id !== "string" ||
    typeof record.createdAt !== "number"
  ) {
    return false;
  }
  if (record.type === "url" || record.type === "text") {
    return typeof record.value === "string";
  }
  return record.type === "image" && typeof record.fileUri === "string";
}

function deleteLocalImage(record: PendingShareIntent | null) {
  if (record?.type !== "image") return;
  try {
    const file = new File(record.fileUri);
    if (file.exists) file.delete();
  } catch {
    // Cleanup is best effort; the 24-hour sweep will retry.
  }
}

export function getPendingShareIntent(): PendingShareIntent | null {
  const serialized = storage.getString(STORAGE_KEY);
  if (!serialized) return null;
  try {
    const value: unknown = JSON.parse(serialized);
    if (!isPendingShareIntent(value)) {
      storage.remove(STORAGE_KEY);
      return null;
    }
    if (
      Date.now() - value.createdAt >
      RECIPE_IMPORT_LIMITS.pendingIntentRetentionMs
    ) {
      deleteLocalImage(value);
      storage.remove(STORAGE_KEY);
      return null;
    }
    return value;
  } catch {
    storage.remove(STORAGE_KEY);
    return null;
  }
}

export function savePendingShareIntent(record: PendingShareIntent) {
  storage.set(STORAGE_KEY, JSON.stringify(record));
}

function replacePendingShareIntent(record: PendingShareIntent) {
  const previous = getPendingShareIntent();
  savePendingShareIntent(record);
  if (previous?.id !== record.id) {
    deleteLocalImage(previous);
  }
}

export function updatePendingShareIntent(
  id: string,
  patch: { importType?: RecipeImportType; uploadKey?: string },
) {
  const current = getPendingShareIntent();
  if (!current || current.id !== id) return null;
  const updated =
    current.type === "image"
      ? ({ ...current, ...patch } as PendingShareIntent)
      : ({ ...current, importType: patch.importType } as PendingShareIntent);
  savePendingShareIntent(updated);
  return updated;
}

export function clearPendingShareIntent(id?: string) {
  const current = getPendingShareIntent();
  if (!current || (id && current.id !== id)) return;
  deleteLocalImage(current);
  storage.remove(STORAGE_KEY);
}

export async function persistDetectedShareIntent(
  detected: DetectedShareIntent,
): Promise<PendingShareIntent> {
  const id = Crypto.randomUUID();
  const createdAt = Date.now();
  if (detected.type !== "image") {
    const record: PendingShareIntent = {
      version: RECORD_VERSION,
      id,
      type: detected.type,
      value: detected.content,
      createdAt,
    };
    replacePendingShareIntent(record);
    return record;
  }

  importDirectory.create({ idempotent: true, intermediates: true });
  const mimeType =
    detected.mimeType === "image/png" || detected.mimeType === "image/webp"
      ? detected.mimeType
      : "image/jpeg";
  const extension =
    mimeType === "image/png"
      ? "png"
      : mimeType === "image/webp"
        ? "webp"
        : "jpg";
  const destination = new File(importDirectory, `${id}.${extension}`);
  await new File(detected.content).copy(destination, { overwrite: true });
  const record: PendingShareIntent = {
    version: RECORD_VERSION,
    id,
    type: "image",
    fileUri: destination.uri,
    mimeType,
    createdAt,
  };
  replacePendingShareIntent(record);
  return record;
}
