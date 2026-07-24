import { describe, it, expect } from 'vitest';
import { describeStorageError, UPLOAD_ERROR_TOAST_DURATION } from '@/lib/storageError';

// Mimics @supabase/storage-js StorageApiError (status: number, statusCode: string).
function apiError(status: number, message: string) {
  return { name: 'StorageApiError', message, status, statusCode: String(status) };
}
// Mimics StorageUnknownError (carries originalError, no status).
function unknownError(message: string) {
  return { name: 'StorageUnknownError', message, originalError: new TypeError(message) };
}

describe('describeStorageError', () => {
  it('413 payload-too-large → curated size message, code 413', () => {
    const info = describeStorageError(apiError(413, 'The object exceeded the maximum allowed size'));
    expect(info.code).toBe('413');
    expect(info.userMessage).toBe('This file is too large to upload.');
    expect(info.logLine).toContain('[413]');
  });

  it('415 unsupported-media → curated type message', () => {
    const info = describeStorageError(apiError(415, 'mime type text/x-evil is not supported'));
    expect(info.code).toBe('415');
    expect(info.userMessage).toBe("That file type isn't supported.");
  });

  it('409 conflict → curated duplicate message', () => {
    const info = describeStorageError(apiError(409, 'The resource already exists'));
    expect(info.code).toBe('409');
    expect(info.userMessage).toBe('A file with that name already exists.');
  });

  it('400 RLS rejection → generic message, raw body ONLY in logLine', () => {
    const rls = 'new row violates row-level security policy for table "objects"';
    const info = describeStorageError(apiError(400, rls));
    expect(info.code).toBe('400');
    expect(info.userMessage).not.toContain('row-level');
    expect(info.userMessage).toContain('400');
    expect(info.logLine).toContain(rls);
  });

  it('5xx → generic message, code preserved', () => {
    const info = describeStorageError(apiError(503, 'upstream unavailable'));
    expect(info.code).toBe('503');
    expect(info.userMessage).not.toContain('upstream');
    expect(info.userMessage).toContain('503');
  });

  it('StorageUnknownError (fetch never completed) → code network', () => {
    const info = describeStorageError(unknownError('Failed to fetch'));
    expect(info.code).toBe('network');
    expect(info.logLine).toContain('[network]');
  });

  it('plain Error → code unknown, message in logLine', () => {
    const info = describeStorageError(new Error('boom'));
    expect(info.code).toBe('unknown');
    expect(info.logLine).toContain('boom');
  });

  it('non-error value → fallback via String()', () => {
    const info = describeStorageError('just a string');
    expect(info.code).toBe('unknown');
    expect(info.logLine).toContain('just a string');
  });

  it('logLine is always single-line and starts with a bracketed code', () => {
    const info = describeStorageError(apiError(400, 'line1\nline2'));
    expect(info.logLine.startsWith('[')).toBe(true);
    expect(info.logLine).not.toContain('\n');
  });

  it('exports a toast duration longer than the ~5s default', () => {
    expect(UPLOAD_ERROR_TOAST_DURATION).toBeGreaterThan(5000);
  });
});
