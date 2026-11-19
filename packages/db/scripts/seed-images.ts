/**
 * Make seeded photos visible in the app.
 *
 * The seed stores Unsplash URLs, but the app only loads images served by
 * our image worker. This copies each seeded photo into the development R2
 * bucket at its `seed/…` storage key and points the rows at the worker.
 *
 * Usage (from packages/db):
 *   bun run seed:images            # dry run, lists what would change
 *   bun run seed:images --apply    # download, upload to R2, update rows
 *
 * Re-runnable: rows already pointing at the worker are skipped.
 */
import { neon } from "@neondatabase/serverless";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const BUCKET = "cook-club-images-development";
const IMAGE_PUBLIC_URL = (
  process.env.IMAGE_PUBLIC_URL ?? "http://localhost:8789"
).replace(/\/$/, "");
const IMAGES_APP_DIR = resolve(__dirname, "../../../apps/images");
const TABLES = ["recipe_images", "cooking_review_images"] as const;

const apply = process.argv.includes("--apply");

function sizedSourceUrl(url: string): string {
  const u = new URL(url);
  if (u.hostname === "images.unsplash.com") {
    u.searchParams.set("w", "1200");
    u.searchParams.set("q", "80");
    u.searchParams.set("fm", "jpg");
  }
  return u.toString();
}

/** Width/height from a baseline or progressive JPEG's SOF marker. */
function jpegSize(bytes: Uint8Array): { width: number; height: number } {
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1]!;
    const length = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker)
    ) {
      return {
        height: (bytes[i + 5]! << 8) | bytes[i + 6]!,
        width: (bytes[i + 7]! << 8) | bytes[i + 8]!,
      };
    }
    i += 2 + length;
  }
  throw new Error("Not a JPEG or no size marker found");
}

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const sql = neon(DATABASE_URL);

  // Distinct source photos still pointing outside the image worker.
  const sources = new Map<string, string>(); // storageKey -> source url
  for (const table of TABLES) {
    const rows = (await sql.query(
      `select distinct storage_key, url from ${table} where url not like $1`,
      [`${IMAGE_PUBLIC_URL}/%`],
    )) as { storage_key: string; url: string }[];
    for (const row of rows) sources.set(row.storage_key, row.url);
  }

  console.log(
    `${sources.size} seeded photo(s) to copy into ${BUCKET} and serve from ${IMAGE_PUBLIC_URL}`,
  );
  if (!apply) {
    for (const [key, url] of sources) console.log(`  ${key}  ←  ${url}`);
    console.log("\nDry run. Re-run with --apply to upload and update rows.");
    return;
  }

  const dir = mkdtempSync(join(tmpdir(), "cookclub-seed-images-"));
  let done = 0;
  try {
    for (const [key, url] of sources) {
      const response = await fetch(sizedSourceUrl(url), {
        // Wikimedia rejects requests without a descriptive User-Agent.
        headers: { "User-Agent": "cookclub-dev-seed/1.0" },
      });
      if (!response.ok) {
        console.warn(`  skip ${key}: ${response.status} from source`);
        continue;
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      const { width, height } = jpegSize(bytes);
      const file = join(dir, "image.jpg");
      writeFileSync(file, bytes);

      execFileSync(
        "bunx",
        [
          "wrangler",
          "r2",
          "object",
          "put",
          `${BUCKET}/${key}`,
          "--file",
          file,
          "--content-type",
          "image/jpeg",
          "--remote",
        ],
        { cwd: IMAGES_APP_DIR, stdio: "pipe" },
      );

      for (const table of TABLES) {
        await sql.query(
          `update ${table} set url = $1, width = $2, height = $3, byte_size = $4, content_type = 'image/jpeg' where storage_key = $5`,
          [`${IMAGE_PUBLIC_URL}/${key}`, width, height, bytes.length, key],
        );
      }
      done++;
      console.log(`  ✓ ${key} (${width}×${height})`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`\nDone: ${done}/${sources.size} photos copied.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
