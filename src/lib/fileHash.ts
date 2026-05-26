export async function sha256Hex(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  // Copy into a fresh Uint8Array so crypto.subtle.digest receives a current-realm
  // TypedArray. Node 20's webcrypto rejects ArrayBuffers from jsdom's Blob with
  // "2nd argument is not instance of ArrayBuffer, ...".
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(new Uint8Array(buffer));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
