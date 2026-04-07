import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

let _isNative = false;

const mockGetPhoto = vi.fn();

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => _isNative,
  },
}));

vi.mock('@capacitor/camera', () => ({
  Camera: {
    getPhoto: (...args: unknown[]) => mockGetPhoto(...args),
  },
  CameraResultType: { Base64: 'base64' },
  CameraSource: { Camera: 'CAMERA' },
}));

import { base64ToBlob, useNativeCamera } from '@/hooks/useNativeCamera';

// ---------------------------------------------------------------------------
// base64ToBlob pure helper
// ---------------------------------------------------------------------------
describe('base64ToBlob', () => {
  it('converts a valid base64 string to a Blob', () => {
    const blob = base64ToBlob('SGVsbG8=', 'jpeg');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBe(5);
    expect(blob.type).toBe('image/jpeg');
  });

  it('handles empty string and returns empty Blob', () => {
    const blob = base64ToBlob('', 'png');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBe(0);
    expect(blob.type).toBe('image/png');
  });

  it('uses the provided image format in the MIME type', () => {
    const blob = base64ToBlob('dGVzdA==', 'webp');
    expect(blob.type).toBe('image/webp');
  });

  it('produces the correct byte values', () => {
    // base64 for [0x01, 0x02, 0x03]
    const blob = base64ToBlob('AQID', 'jpeg');
    expect(blob.size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// useNativeCamera hook – web platform
// ---------------------------------------------------------------------------
describe('useNativeCamera hook – web platform', () => {
  beforeEach(() => {
    _isNative = false;
    vi.clearAllMocks();
  });

  it('exposes isNative=false on web', () => {
    const { result } = renderHook(() => useNativeCamera());
    expect(result.current.isNative).toBe(false);
  });

  it('exposes a takePhoto function', () => {
    const { result } = renderHook(() => useNativeCamera());
    expect(typeof result.current.takePhoto).toBe('function');
  });

  it('takePhoto() returns null on web without calling Camera.getPhoto', async () => {
    const { result } = renderHook(() => useNativeCamera());
    let photoResult: Blob | null | undefined;
    await act(async () => {
      photoResult = await result.current.takePhoto();
    });
    expect(photoResult).toBeNull();
    expect(mockGetPhoto).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// useNativeCamera hook – native platform
// ---------------------------------------------------------------------------
describe('useNativeCamera hook – native platform', () => {
  beforeEach(() => {
    _isNative = true;
    vi.clearAllMocks();
  });

  it('exposes isNative=true on native', () => {
    const { result } = renderHook(() => useNativeCamera());
    expect(result.current.isNative).toBe(true);
  });

  it('takePhoto() calls Camera.getPhoto with correct options', async () => {
    mockGetPhoto.mockResolvedValue({ base64String: 'SGVsbG8=', format: 'jpeg' });
    const { result } = renderHook(() => useNativeCamera());

    await act(async () => {
      await result.current.takePhoto();
    });

    expect(mockGetPhoto).toHaveBeenCalledWith({
      quality: 80,
      source: 'CAMERA',
      resultType: 'base64',
      width: 480,
    });
  });

  it('takePhoto() returns a Blob on success', async () => {
    mockGetPhoto.mockResolvedValue({ base64String: 'SGVsbG8=', format: 'jpeg' });
    const { result } = renderHook(() => useNativeCamera());

    let photoResult: Blob | null | undefined;
    await act(async () => {
      photoResult = await result.current.takePhoto();
    });

    expect(photoResult).toBeInstanceOf(Blob);
    expect((photoResult as Blob).type).toBe('image/jpeg');
  });

  it('takePhoto() returns null when photo has no base64String', async () => {
    mockGetPhoto.mockResolvedValue({ base64String: null, format: 'jpeg' });
    const { result } = renderHook(() => useNativeCamera());

    let photoResult: Blob | null | undefined;
    await act(async () => {
      photoResult = await result.current.takePhoto();
    });

    expect(photoResult).toBeNull();
  });

  it('takePhoto() returns null when base64String is empty string', async () => {
    mockGetPhoto.mockResolvedValue({ base64String: '', format: 'png' });
    const { result } = renderHook(() => useNativeCamera());

    let photoResult: Blob | null | undefined;
    await act(async () => {
      photoResult = await result.current.takePhoto();
    });

    // base64ToBlob('', ...) returns empty Blob (truthy Blob object), but the
    // hook checks `if (!photo.base64String) return null`
    expect(photoResult).toBeNull();
  });
});
