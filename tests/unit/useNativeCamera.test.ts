import { describe, it, expect, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false }
}));

vi.mock('@capacitor/camera', () => ({
  Camera: { getPhoto: vi.fn() },
  CameraResultType: { Base64: 'base64' },
  CameraSource: { Camera: 'CAMERA' },
}));

import { base64ToBlob } from '@/hooks/useNativeCamera';

describe('useNativeCamera', () => {
  it('base64ToBlob converts base64 string to Blob', () => {
    const blob = base64ToBlob('SGVsbG8=', 'jpeg');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBe(5);
    expect(blob.type).toBe('image/jpeg');
  });

  it('base64ToBlob handles empty string', () => {
    const blob = base64ToBlob('', 'png');
    expect(blob.size).toBe(0);
  });
});
