import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

/**
 * MIME types for the media formats the post channels accept, keyed by
 * lowercase file extension.
 */
const MIME_TYPES_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
};

const DEFAULT_MIME_TYPE = "application/octet-stream";

export function mimeTypeForPath(filePath: string): string {
  return MIME_TYPES_BY_EXTENSION[extname(filePath).toLowerCase()] ?? DEFAULT_MIME_TYPE;
}

/**
 * Node fallback for getFileBlob. Exported so this branch stays testable: the
 * test runner is Bun, where getFileBlob always takes the Bun.file() path.
 */
export async function readFileAsBlob(filePath: string): Promise<Blob> {
  const buffer = await readFile(filePath);
  return new Blob([buffer], { type: mimeTypeForPath(filePath) });
}

/**
 * Returns a Blob-like object for the given file path.
 * Uses Bun.file() if available, otherwise falls back to node:fs and Blob.
 *
 * Both paths must carry a MIME type. Bun.file() infers one from the extension;
 * an untyped Blob is uploaded as application/octet-stream, and the media
 * service names the stored file after the MIME type — so a .png went up and
 * came back as .bin.
 */
export async function getFileBlob(filePath: string): Promise<Blob> {
  // @ts-ignore - Bun is global in Bun environment
  if (typeof Bun !== "undefined") {
    // @ts-ignore
    return Bun.file(filePath);
  }

  return readFileAsBlob(filePath);
}

export { basename };
