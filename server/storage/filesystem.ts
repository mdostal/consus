import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { StorageAdapter, Metadata } from "./adapter.js";

/**
 * Local-disk StorageAdapter. Ported from origin/feat/PAN-7819's
 * server/storage/filesystem.ts — behavior is unchanged (upload writes a
 * randomUUID-named file under `baseDir`, download/delete look it up by that
 * id). What changed for this port: `baseDir` no longer defaults to
 * `<cwd>/data/attachments` — Consus's local-state convention (see
 * CONSUS_DB_PATH/CONSUS_PROJECTS_CONFIG) keeps everything under `.pHive/`,
 * so callers (server/index.ts) resolve `.pHive/attachments` /
 * CONSUS_ATTACHMENTS_DIR themselves and always pass an explicit baseDir.
 */
export class FilesystemStorage implements StorageAdapter {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
  }

  async upload(file: File, _metadata?: Metadata): Promise<string> {
    await this.ensureDir();
    const id = randomUUID();
    const filePath = join(this.baseDir, id);

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);

    return id;
  }

  async download(id: string): Promise<Blob> {
    const filePath = join(this.baseDir, id);
    try {
      const buffer = await readFile(filePath);
      return new Blob([buffer]);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`File with id ${id} not found`);
      }
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    const filePath = join(this.baseDir, id);
    try {
      await rm(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return; // Already deleted or never existed.
      }
      throw error;
    }
  }
}
