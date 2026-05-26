import { describe, it, expect } from 'vitest';
import { sha256Hex } from '@/lib/fileHash';

describe('sha256Hex', () => {
  it('returns the canonical SHA-256 of the empty input as lowercase hex', async () => {
    const result = await sha256Hex(new Blob([]));
    expect(result).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('returns the canonical SHA-256 of "hello" (UTF-8 bytes)', async () => {
    const result = await sha256Hex(new Blob(['hello']));
    expect(result).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });

  it('returns lowercase hex (no uppercase characters)', async () => {
    const result = await sha256Hex(new Blob(['abc']));
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable across multiple calls with the same input', async () => {
    const blob = new Blob([new Uint8Array([0xde, 0xad, 0xbe, 0xef])]);
    const a = await sha256Hex(blob);
    const b = await sha256Hex(blob);
    expect(a).toBe(b);
  });
});
