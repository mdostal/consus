/**
 * Ported from origin/feat/PAN-7819's server/storage/adapter.ts (see
 * consus-phase23-decision-attachments/docs/design-discussion.md §2-3) — the
 * shape is unchanged: `File`/`Blob` are used directly rather than
 * Buffer-based signatures because they're genuinely available as Node
 * globals under this build (confirmed during this story's research step:
 * Node >=20, this repo's CI pins Node 22, server/tsconfig.json's
 * `@types/node` ships global `File`/`Blob` declarations with no DOM lib
 * needed) — see design-discussion.md §5's risk note.
 */
export interface Metadata {
  name?: string;
  type?: string;
  size?: number;
  [key: string]: unknown;
}

export interface StorageAdapter {
  upload(file: File, metadata?: Metadata): Promise<string>;
  download(id: string): Promise<Blob>;
  delete(id: string): Promise<void>;
}
