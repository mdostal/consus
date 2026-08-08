/**
 * @vitest-environment node
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createStorageAdapter } from './index.js';
import { FilesystemStorage } from './filesystem.js';

describe('Storage Layer', () => {
  const testDir = join(process.cwd(), 'data', `test-attachments-${randomUUID()}`);
  
  beforeAll(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('FilesystemStorage', () => {
    it('uploads and downloads a file', async () => {
      const storage = new FilesystemStorage(testDir);
      const testContent = 'hello world';
      const file = new File([testContent], 'test.txt', { type: 'text/plain' });
      
      const id = await storage.upload(file);
      expect(id).toBeTruthy();

      const downloadedBlob = await storage.download(id);
      const text = await downloadedBlob.text();
      expect(text).toBe(testContent);
    });

    it('deletes a file', async () => {
      const storage = new FilesystemStorage(testDir);
      const testContent = 'to be deleted';
      const file = new File([testContent], 'delete.txt', { type: 'text/plain' });
      
      const id = await storage.upload(file);
      await storage.delete(id);

      await expect(storage.download(id)).rejects.toThrow('not found');
    });

    it('delete is idempotent', async () => {
      const storage = new FilesystemStorage(testDir);
      // deleting non-existent file should not throw
      await expect(storage.delete('non-existent-id')).resolves.toBeUndefined();
    });
  });

  describe('createStorageAdapter factory', () => {
    it('creates filesystem adapter', () => {
      const storage = createStorageAdapter({ type: 'filesystem', baseDir: testDir });
      expect(storage).toBeInstanceOf(FilesystemStorage);
    });

    it('creates S3 adapter but methods throw for stub', async () => {
      const storage = createStorageAdapter({ type: 's3', bucket: 'test-bucket' });
      const file = new File(['test'], 'test.txt');
      
      await expect(storage.upload(file)).rejects.toThrow('not yet implemented');
    });

    it('throws if S3 bucket missing', () => {
      expect(() => {
        createStorageAdapter({ type: 's3' } as any);
      }).toThrow(/requires a bucket/);
    });
  });
});
