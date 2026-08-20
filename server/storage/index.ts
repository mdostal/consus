import type { StorageAdapter } from "./adapter.js";
import { FilesystemStorage } from "./filesystem.js";

export * from "./adapter.js";
export * from "./filesystem.js";

export interface StorageAdapterConfig {
  /** Only "filesystem" is implemented today. The field (and this factory)
   *  exist so a future backend can slot in later without callers changing
   *  — see design-discussion.md §2/§3.3: S3Storage was deliberately not
   *  ported in this story (Consus is standalone/local-first, no current
   *  cloud-deploy need), so nothing besides "filesystem" is constructible
   *  yet. */
  type?: "filesystem";
  baseDir: string;
}

export function createStorageAdapter(config: StorageAdapterConfig): StorageAdapter {
  return new FilesystemStorage(config.baseDir);
}
