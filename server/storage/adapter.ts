export interface Metadata {
  name?: string;
  type?: string;
  size?: number;
  [key: string]: any;
}

export interface StorageAdapter {
  upload(file: File, metadata?: Metadata): Promise<string>;
  download(id: string): Promise<Blob>;
  delete(id: string): Promise<void>;
}
