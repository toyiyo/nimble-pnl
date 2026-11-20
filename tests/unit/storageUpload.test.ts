import { describe, it, expect, vi } from 'vitest';
import { EmptyUploadError, uploadBlobBytes } from '@/lib/storageUpload';
import { describeStorageError } from '@/lib/storageError';

function makeBucket(result: unknown = { data: { path: 'a/b.png' }, error: null }) {
  return { upload: vi.fn().mockResolvedValue(result) };
}

describe('uploadBlobBytes', () => {
  it('sends an ArrayBuffer with the same bytes', async () => {
    const bucket = makeBucket();
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' });
    await uploadBlobBytes(bucket as never, 'a/b.png', blob);
    const arg = bucket.upload.mock.calls[0][1];
    expect(Object.prototype.toString.call(arg)).toBe('[object ArrayBuffer]');
    expect(arg.byteLength).toBe(4);
    expect(Array.from(new Uint8Array(arg))).toEqual([1, 2, 3, 4]);
  });

  it('sets contentType from blob.type', async () => {
    const bucket = makeBucket();
    await uploadBlobBytes(bucket as never, 'p', new Blob(['x'], { type: 'image/jpeg' }));
    expect(bucket.upload.mock.calls[0][2]).toMatchObject({ contentType: 'image/jpeg' });
  });

  it('keeps an explicit contentType and other options', async () => {
    const bucket = makeBucket();
    await uploadBlobBytes(bucket as never, 'p', new Blob(['x'], { type: 'image/jpeg' }), {
      contentType: 'application/pdf',
      upsert: false,
      cacheControl: '60',
    });
    expect(bucket.upload.mock.calls[0][2]).toEqual({
      contentType: 'application/pdf',
      upsert: false,
      cacheControl: '60',
    });
  });

  it('falls back to application/octet-stream for empty types', async () => {
    const bucket = makeBucket();
    await uploadBlobBytes(bucket as never, 'p', new Blob(['x']), { contentType: '' });
    expect(bucket.upload.mock.calls[0][2]).toMatchObject({
      contentType: 'application/octet-stream',
    });
  });

  it('returns EmptyUploadError for a 0-byte blob and does not upload', async () => {
    const bucket = makeBucket();
    const res = await uploadBlobBytes(bucket as never, 'p', new Blob([], { type: 'image/png' }));
    expect(res.data).toBeNull();
    expect(res.error).toBeInstanceOf(EmptyUploadError);
    expect(bucket.upload).not.toHaveBeenCalled();
  });

  it('returns EmptyUploadError when arrayBuffer() rejects', async () => {
    const bucket = makeBucket();
    const blob = new Blob(['x']);
    blob.arrayBuffer = () => Promise.reject(new Error('NotReadableError'));
    const res = await uploadBlobBytes(bucket as never, 'p', blob);
    expect(res.data).toBeNull();
    expect(res.error).toBeInstanceOf(EmptyUploadError);
    expect(bucket.upload).not.toHaveBeenCalled();
  });

  it('returns the upload result unchanged', async () => {
    const result = { data: null, error: new Error('boom') };
    const bucket = makeBucket(result);
    const res = await uploadBlobBytes(bucket as never, 'p', new Blob(['x']));
    expect(res).toBe(result);
  });

  it('maps EmptyUploadError to code empty in describeStorageError', () => {
    expect(describeStorageError(new EmptyUploadError('empty')).code).toBe('empty');
  });
});
