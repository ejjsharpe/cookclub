import { useTRPC } from "@repo/trpc/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Image as ExpoImage } from "expo-image";
import { useState, useCallback } from "react";

import { normalizeImageForUpload } from "@/utils/imageUtils";

export interface UseAvatarUploadOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Hook for uploading avatar images.
 * Handles the full flow: get presigned URL -> upload to R2 -> move to avatars/ -> update user.
 */
export function useAvatarUpload(options: UseAvatarUploadOptions = {}) {
  const { onSuccess, onError } = options;
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState(0);

  const requestUploadUrlMutation = useMutation(
    trpc.upload.requestUploadUrl.mutationOptions(),
  );

  const uploadAvatarMutation = useMutation(
    trpc.user.uploadAvatar.mutationOptions(),
  );

  const upload = useCallback(
    async (localUri: string): Promise<void> => {
      setProgress(10);

      const normalized = await normalizeImageForUpload(localUri, "avatar");
      setProgress(20);

      // Get presigned URL
      const { uploadUrl, key, maxFileSize } =
        await requestUploadUrlMutation.mutateAsync({
          contentType: normalized.contentType,
          kind: "avatar",
        });
      setProgress(25);

      // Fetch the local image as a blob
      const imageResponse = await fetch(normalized.uri);
      const imageBlob = await imageResponse.blob();
      setProgress(40);

      // Validate file size
      if (imageBlob.size > maxFileSize) {
        throw new Error(
          `File size (${Math.round(imageBlob.size / 1024 / 1024)}MB) exceeds maximum allowed (${Math.round(maxFileSize / 1024 / 1024)}MB)`,
        );
      }

      // Upload to R2
      const uploadResponse = await fetch(uploadUrl, {
        method: "PUT",
        body: imageBlob,
        headers: {
          "Content-Type": normalized.contentType,
        },
      });

      if (!uploadResponse.ok) {
        throw new Error(`Upload failed with status ${uploadResponse.status}`);
      }
      setProgress(70);

      // Finalize: move to avatars/ and update DB
      const updatedUser = await uploadAvatarMutation.mutateAsync({
        imageKey: key,
      });
      setProgress(90);

      // Show the new avatar immediately on mounted screens; invalidation below
      // refreshes other queries that may embed the old user image.
      if (updatedUser.user) {
        queryClient.setQueryData(trpc.user.getUser.queryFilter().queryKey, {
          user: updatedUser.user,
        });
      }

      // Refresh screens and clear image caches that may still hold the old avatar URL.
      await Promise.all([
        queryClient.invalidateQueries(trpc.user.getUser.queryFilter()),
        queryClient.invalidateQueries(trpc.follows.pathFilter()),
        queryClient.invalidateQueries(trpc.activity.pathFilter()),
        ExpoImage.clearMemoryCache().catch(() => false),
        ExpoImage.clearDiskCache().catch(() => false),
      ]);
      setProgress(100);
    },
    [requestUploadUrlMutation, uploadAvatarMutation, queryClient, trpc],
  );

  const uploadMutation = useMutation({
    mutationFn: upload,
    onSuccess: () => {
      setProgress(0);
      onSuccess?.();
    },
    onError: (error: Error) => {
      setProgress(0);
      onError?.(error);
    },
  });

  const reset = useCallback(() => {
    setProgress(0);
    uploadMutation.reset();
  }, [uploadMutation]);

  return {
    upload: uploadMutation.mutateAsync,
    isUploading: uploadMutation.isPending,
    progress,
    error: uploadMutation.error,
    reset,
  };
}
