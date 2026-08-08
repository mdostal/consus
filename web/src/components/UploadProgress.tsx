import React from 'react';

export interface UploadProgressProps {
  progress: number;
  fileName: string;
  error?: string | null;
}

export function UploadProgress({ progress, fileName, error }: UploadProgressProps) {
  return (
    <div style={{ marginTop: '10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
        <span style={{ fontSize: '14px' }}>{fileName}</span>
        {error ? (
          <span style={{ fontSize: '14px', color: 'red' }}>Error</span>
        ) : (
          <span style={{ fontSize: '14px' }}>{progress}%</span>
        )}
      </div>
      <div
        style={{
          width: '100%',
          height: '8px',
          backgroundColor: '#e0e0e0',
          borderRadius: '4px',
          overflow: 'hidden',
        }}
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          style={{
            height: '100%',
            width: `${progress}%`,
            backgroundColor: error ? 'red' : '#4caf50',
            transition: 'width 0.2s ease-in-out',
          }}
        />
      </div>
      {error && (
        <div style={{ color: 'red', fontSize: '12px', marginTop: '4px' }}>
          {error}
        </div>
      )}
    </div>
  );
}
