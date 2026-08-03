type R2ObjectBodyInput =
  ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob;

export async function putAndInspectImage<T>(
  bucket: R2Bucket,
  key: string,
  value: R2ObjectBodyInput,
  options: R2PutOptions,
  inspect: () => Promise<T>,
): Promise<T> {
  try {
    await bucket.put(key, value, options);
    return await inspect();
  } catch (error) {
    try {
      await bucket.delete(key);
    } catch (cleanupError) {
      console.error(
        JSON.stringify({
          event: "image_write_compensation_failed",
          storageKey: key,
          message:
            cleanupError instanceof Error
              ? cleanupError.message
              : "Unknown cleanup error",
        }),
      );
    }

    throw error;
  }
}
