import { isValidImportImageStagingId } from "@repo/contracts/images";

const IMPORT_IMAGE_PREFIX = "imports/";
const IMPORT_IMAGE_LIST_LIMIT = 1000;
const IMPORT_IMAGE_DELETE_CONCURRENCY = 6;

export function importImagePrefix(imageStagingId: string) {
  if (!isValidImportImageStagingId(imageStagingId)) {
    throw new Error("Invalid import image staging id");
  }

  return `${IMPORT_IMAGE_PREFIX}${imageStagingId}/`;
}

export async function deleteImportImages(
  bucket: R2Bucket,
  imageStagingId: string,
): Promise<void> {
  const prefix = importImagePrefix(imageStagingId);

  while (true) {
    const listed = await bucket.list({
      prefix,
      limit: IMPORT_IMAGE_LIST_LIMIT,
    });
    const keys = listed.objects.map((object) => object.key);
    if (keys.length === 0) return;

    await bucket.delete(keys);
  }
}

export async function deleteImportImageStagingIds(
  bucket: R2Bucket,
  imageStagingIds: string[],
): Promise<void> {
  const uniqueIds = Array.from(new Set(imageStagingIds));

  // Validate the complete batch before deleting anything.
  for (const imageStagingId of uniqueIds) {
    importImagePrefix(imageStagingId);
  }

  for (
    let offset = 0;
    offset < uniqueIds.length;
    offset += IMPORT_IMAGE_DELETE_CONCURRENCY
  ) {
    await Promise.all(
      uniqueIds
        .slice(offset, offset + IMPORT_IMAGE_DELETE_CONCURRENCY)
        .map((imageStagingId) => deleteImportImages(bucket, imageStagingId)),
    );
  }
}

export async function listImportImageStagingIds(
  bucket: R2Bucket,
): Promise<string[]> {
  const ids = new Set<string>();
  let cursor: string | undefined;

  do {
    const listed = await bucket.list({
      prefix: IMPORT_IMAGE_PREFIX,
      delimiter: "/",
      limit: IMPORT_IMAGE_LIST_LIMIT,
      ...(cursor && { cursor }),
    });

    for (const prefix of listed.delimitedPrefixes) {
      const id = prefix.slice(IMPORT_IMAGE_PREFIX.length, -1);
      if (
        prefix === `${IMPORT_IMAGE_PREFIX}${id}/` &&
        isValidImportImageStagingId(id)
      ) {
        ids.add(id);
      }
    }

    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return Array.from(ids);
}
