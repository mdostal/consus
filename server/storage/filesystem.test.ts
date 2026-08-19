/**
 * @vitest-environment node
 *
 * This repo's vitest.config.ts sets a global `environment: "jsdom"` (needed
 * for the web/ component tests). jsdom's own global `File`/`Blob` are stub
 * implementations missing `arrayBuffer()`/`stream()`/`text()` (confirmed by
 * running this suite under the default jsdom env during this story's
 * implementation — see design-discussion.md §5's File/Blob risk note, and
 * origin/feat/PAN-7819's own attachments.test.ts, which carried this exact
 * same docblock for this exact same reason). Forcing the real Node
 * environment for this file restores real File/Blob (`.arrayBuffer()` etc.)
 * — production code is unaffected either way, since it never runs under
 * jsdom.
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FilesystemStorage } from "./filesystem.js";

describe("FilesystemStorage", () => {
  let dir: string;

  afterEach(() => {
    if (dir && existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("round-trips upload -> download bytes unchanged", async () => {
    dir = mkdtempSync(join(tmpdir(), "consus-fs-storage-"));
    const storage = new FilesystemStorage(dir);
    const file = new File([Buffer.from("round trip content")], "a.txt", { type: "text/plain" });

    const id = await storage.upload(file);
    const blob = await storage.download(id);
    const buf = Buffer.from(await blob.arrayBuffer());

    expect(buf.toString()).toBe("round trip content");
  });

  it("creates the base directory lazily on first upload (not at construction time)", async () => {
    const parent = mkdtempSync(join(tmpdir(), "consus-fs-storage-"));
    dir = join(parent, "nested", "attachments");
    const storage = new FilesystemStorage(dir);

    expect(existsSync(dir)).toBe(false);

    await storage.upload(new File([Buffer.from("x")], "a.txt", { type: "text/plain" }));

    expect(existsSync(dir)).toBe(true);
  });

  it("delete removes the file from disk, so a subsequent download fails", async () => {
    dir = mkdtempSync(join(tmpdir(), "consus-fs-storage-"));
    const storage = new FilesystemStorage(dir);
    const id = await storage.upload(new File([Buffer.from("x")], "a.txt", { type: "text/plain" }));

    await storage.delete(id);

    await expect(storage.download(id)).rejects.toThrow();
  });

  it("delete does not throw for an id that was never uploaded", async () => {
    dir = mkdtempSync(join(tmpdir(), "consus-fs-storage-"));
    const storage = new FilesystemStorage(dir);

    await expect(storage.delete("never-existed")).resolves.not.toThrow();
  });

  it("download rejects for an id that was never uploaded", async () => {
    dir = mkdtempSync(join(tmpdir(), "consus-fs-storage-"));
    const storage = new FilesystemStorage(dir);

    await expect(storage.download("never-existed")).rejects.toThrow();
  });
});
