import { StorageAdapter, Metadata } from './adapter.js';

export class S3Storage implements StorageAdapter {
  private bucket: string;

  constructor(bucket: string) {
    this.bucket = bucket;
  }

  async upload(file: File, metadata?: Metadata): Promise<string> {
    throw new Error('S3 upload not yet implemented. Use filesystem storage for now.');
  }

  async download(id: string): Promise<Blob> {
    throw new Error('S3 download not yet implemented. Use filesystem storage for now.');
  }

  async delete(id: string): Promise<void> {
    throw new Error('S3 delete not yet implemented. Use filesystem storage for now.');
  }
}
