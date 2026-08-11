import { useState, useCallback } from 'react';
import { API_BASE_URL } from '../config';

export interface FileUploadHook {
  upload: (file: File) => Promise<any>;
  progress: number;
  isUploading: boolean;
  error: string | null;
}

export interface UseFileUploadOptions {
  ticketId?: string;
}

export function useFileUpload(options: UseFileUploadOptions = {}): FileUploadHook {
  const [progress, setProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { ticketId } = options;

  const upload = useCallback((file: File) => {
    return new Promise((resolve, reject) => {
      setIsUploading(true);
      setProgress(0);
      setError(null);

      const xhr = new XMLHttpRequest();
      const url = ticketId
        ? `${API_BASE_URL}/api/tickets/${encodeURIComponent(ticketId)}/attachments`
        : `${API_BASE_URL}/api/attachments`;

      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          const percentComplete = Math.round((event.loaded / event.total) * 100);
          setProgress(percentComplete);
        }
      });

      xhr.addEventListener('load', () => {
        setIsUploading(false);
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText);
            resolve(response);
          } catch (e) {
            resolve(xhr.responseText); // In case it's not JSON
          }
        } else {
          let errorMessage = `HTTP ${xhr.status}`;
          try {
            const response = JSON.parse(xhr.responseText);
            if (response.error) {
              errorMessage = response.error;
            }
          } catch (e) {
            // ignore
          }
          setError(errorMessage);
          reject(new Error(`Upload failed: ${errorMessage}`));
        }
      });

      xhr.addEventListener('error', () => {
        setIsUploading(false);
        const errorMessage = 'Network Error';
        setError(errorMessage);
        reject(new Error(`Upload failed: ${errorMessage}`));
      });

      xhr.addEventListener('abort', () => {
        setIsUploading(false);
        const errorMessage = 'Upload Aborted';
        setError(errorMessage);
        reject(new Error(errorMessage));
      });

      xhr.open('POST', url, true);
      const formData = new FormData();
      formData.append('file', file);
      xhr.send(formData);
    });
  }, [ticketId]);

  return { upload, progress, isUploading, error };
}
