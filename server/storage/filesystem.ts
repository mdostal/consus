import { mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { StorageAdapter, Metadata } from './adapter.js';

export class FilesystemStorage implements StorageAdapter {
  private baseDir: string;

  constructor(baseDir: string = join(process.cwd(), 'data', 'attachments')) {
    this.baseDir = baseDir;
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
  }

  async upload(file: File, metadata?: Metadata): Promise<string> {
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
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error(`File with id ${id} not found`);
      }
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    const filePath = join(this.baseDir, id);
    try {
      await rm(filePath);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return; // Already deleted or doesn't exist
      }
      throw error;
    }
  }
}
