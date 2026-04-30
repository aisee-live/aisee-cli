import { readFile } from "node:fs/promises";
import { basename } from "node:path";

/**
 * Returns a Blob-like object for the given file path.
 * Uses Bun.file() if available, otherwise falls back to node:fs and Blob.
 */
export async function getFileBlob(filePath: string): Promise<Blob> {
  // @ts-ignore - Bun is global in Bun environment
  if (typeof Bun !== "undefined") {
    // @ts-ignore
    return Bun.file(filePath);
  }

  // Node.js fallback
  const buffer = await readFile(filePath);
  return new Blob([buffer]);
}

export { basename };
