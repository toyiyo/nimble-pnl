import type { supabase } from '@/integrations/supabase/client';

type Bucket = ReturnType<typeof supabase.storage.from>;
type UploadOptions = Parameters<Bucket['upload']>[2];
type UploadData = NonNullable<Awaited<ReturnType<Bucket['upload']>>['data']>;

/** Carries status 'empty' so describeStorageError maps it to the empty-file message. */
export class EmptyUploadError extends Error {
  readonly status = 'empty';
}

/**
 * Upload a Blob as raw bytes. Safari can send an empty multipart body for a Blob.
 * An ArrayBuffer takes the raw-body path in storage-js and avoids that fault.
 * If `signal` aborts before the read completes, the helper does not upload.
 */
export async function uploadBlobBytes(
  bucket: Pick<Bucket, 'upload'>,
  path: string,
  blob: Blob,
  options?: UploadOptions,
  signal?: AbortSignal,
): Promise<{ data: UploadData | null; error: Error | null }> {
  let bytes: ArrayBuffer;
  try {
    bytes = await blob.arrayBuffer();
  } catch {
    return { data: null, error: new EmptyUploadError('Could not read the file bytes.') };
  }
  if (signal?.aborted) {
    return { data: null, error: new DOMException('The upload was cancelled.', 'AbortError') };
  }
  if (bytes.byteLength === 0) {
    return { data: null, error: new EmptyUploadError('The file has 0 bytes.') };
  }
  const contentType = options?.contentType || blob.type || 'application/octet-stream';
  return bucket.upload(path, bytes, { ...options, contentType });
}
