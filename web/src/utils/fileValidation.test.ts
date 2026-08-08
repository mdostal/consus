import { validateFile, MAX_FILE_SIZE } from './fileValidation';
import { describe, it, expect } from 'vitest';

describe('fileValidation', () => {
  it('validates a correct file', () => {
    const file = new File(['content'], 'test.png', { type: 'image/png' });
    const result = validateFile(file);
    expect(result.valid).toBe(true);
  });

  it('rejects a file larger than 10MB', () => {
    // Note: this doesn't actually allocate 10MB, it just fakes the size property since File might not allow fake large sizes easily without allocating,
    // wait, File constructor takes an array of parts.
    const file = new File([new ArrayBuffer(MAX_FILE_SIZE + 1)], 'test.png', { type: 'image/png' });
    const result = validateFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/exceeds 10MB/);
  });

  it('rejects disallowed file types', () => {
    const file = new File(['content'], 'test.exe', { type: 'application/x-msdownload' });
    const result = validateFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/type not allowed/);
  });
});
