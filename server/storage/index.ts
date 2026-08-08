import { StorageAdapter } from './adapter.js';
import { FilesystemStorage } from './filesystem.js';
import { S3Storage } from './s3.js';

export * from './adapter.js';
export * from './filesystem.js';
export * from './s3.js';

export function createStorageAdapter(config: { type: 'filesystem' | 's3'; [key: string]: any }): StorageAdapter {
  if (config.type === 's3') {
    if (!config.bucket) {
      throw new Error('S3 storage requires a bucket config');
    }
    return new S3Storage(config.bucket);
  }

  // Default to filesystem
  return new FilesystemStorage(config.baseDir);
}
