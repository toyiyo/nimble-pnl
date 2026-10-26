// Path check for files in the private `receipt-images` bucket.
//
// No Deno imports: the unit tests run this file in Node.

const BUCKET_PATH = /\/receipt-images\/([^?#]+)/;

/**
 * Returns the storage path for a receipt file, or null when the file is not
 * in the folder of `restaurantId`.
 *
 * `rawFileUrl` is a bucket path (`<restaurant_id>/...`) or, on old rows, a
 * full storage URL. The caller downloads with the service role, which skips
 * storage RLS. So this check is the only thing that keeps a row of one
 * restaurant from pointing at the file of another restaurant.
 */
export function receiptStoragePath(rawFileUrl: string, restaurantId: string): string | null {
  if (!rawFileUrl || !restaurantId) return null;

  let path = rawFileUrl;
  if (/^https?:\/\//i.test(path)) {
    const match = BUCKET_PATH.exec(path);
    if (!match) return null;
    path = match[1];
  }

  // The URL parser in fetch() turns `%2e%2e` into `..`, turns `\` into `/`,
  // and deletes tab and newline characters. Any of these can move the
  // download out of the restaurant folder, so refuse them all.
  // eslint-disable-next-line no-control-regex
  if (/[%\\\u0000-\u001f\u007f]/.test(path)) return null;

  const segments = path.split('/');
  if (segments.length < 2) return null;
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return null;
  // Exact match, as the storage RLS compares `restaurant_id::text` with case.
  if (segments[0] !== restaurantId) return null;

  return path;
}
