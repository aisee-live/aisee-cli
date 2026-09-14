import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getFileBlob, mimeTypeForPath, readFileAsBlob } from "../src/utils/file-adapter.ts";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let workDir: string;
let pngPath: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "aisee-file-adapter-"));
  pngPath = join(workDir, "photo.png");
  await writeFile(pngPath, PNG_BYTES);
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("mimeTypeForPath", () => {
  it.each([
    ["photo.png", "image/png"],
    ["photo.jpg", "image/jpeg"],
    ["photo.jpeg", "image/jpeg"],
    ["photo.gif", "image/gif"],
    ["photo.webp", "image/webp"],
    ["clip.mp4", "video/mp4"],
  ])("should map %s to %s", (fileName, expected) => {
    expect(mimeTypeForPath(fileName)).toBe(expected);
  });

  it("should match the extension case-insensitively when the file is named in upper case", () => {
    expect(mimeTypeForPath("/tmp/PHOTO.PNG")).toBe("image/png");
  });

  it("should fall back to a generic binary type when the extension is unknown", () => {
    expect(mimeTypeForPath("archive.xyz")).toBe("application/octet-stream");
  });

  it("should fall back to a generic binary type when the file has no extension", () => {
    expect(mimeTypeForPath("/tmp/photo")).toBe("application/octet-stream");
  });
});

describe("readFileAsBlob — the Node path, which getFileBlob takes outside Bun", () => {
  it("should set the MIME type when the file is an image", async () => {
    const blob = await readFileAsBlob(pngPath);
    expect(blob.type).toBe("image/png");
  });

  it("should preserve the file bytes when reading", async () => {
    const blob = await readFileAsBlob(pngPath);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(PNG_BYTES);
  });

  // The upload sends an untyped Blob as application/octet-stream, and the media
  // service names the stored file after the MIME type — a .png came back .bin.
  it("should send an image content type in the multipart body when uploaded the way uploadMedia builds it", async () => {
    const formData = new FormData();
    formData.append("file", await readFileAsBlob(pngPath), "photo.png");
    const body = await new Request("http://media.test", { method: "POST", body: formData }).text();

    expect(body).toContain("Content-Type: image/png");
    expect(body).not.toContain("application/octet-stream");
  });
});

describe("getFileBlob", () => {
  it("should report the same MIME type as the Node path when running under Bun", async () => {
    const blob = await getFileBlob(pngPath);
    expect(blob.type).toBe(mimeTypeForPath(pngPath));
  });
});
