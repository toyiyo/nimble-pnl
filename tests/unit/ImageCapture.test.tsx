import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React, { createRef } from 'react';
import { ImageCapture, type ImageCaptureHandle } from '@/components/ImageCapture';

// useNativeCamera is a hook that reaches into Capacitor — stub it so the web
// path runs in jsdom.
vi.mock('@/hooks/useNativeCamera', () => ({
  useNativeCamera: () => ({ isNative: false, takePhoto: vi.fn() }),
}));

// jsdom doesn't implement HTMLMediaElement.play(). Stub it so the autoStart
// effect doesn't blow up.
beforeEach(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Fake MediaStream that records stop() calls so we can assert teardown.
 * The interesting surface for ImageCapture is just getTracks().forEach(t => t.stop()).
 */
function makeFakeStream(stopSpy: () => void): MediaStream {
  const tracks = [
    { kind: 'video', stop: stopSpy, addEventListener: vi.fn(), removeEventListener: vi.fn() },
  ];
  return {
    id: 'fake-stream',
    active: true,
    getTracks: () => tracks,
    getVideoTracks: () => tracks,
    getAudioTracks: () => [],
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaStream;
}

function mockGetUserMedia(stream: MediaStream) {
  const spy = vi.fn().mockResolvedValue(stream);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: spy },
  });
  return spy;
}

describe('ImageCapture imperative handle', () => {
  it('forwards a ref exposing stopCamera()', async () => {
    const stopSpy = vi.fn();
    const stream = makeFakeStream(stopSpy);
    mockGetUserMedia(stream);

    const ref = createRef<ImageCaptureHandle>();
    render(
      <ImageCapture
        ref={ref}
        onImageCaptured={() => {}}
        autoStart
      />,
    );

    await waitFor(() => expect(ref.current?.stopCamera).toBeTypeOf('function'));
  });

  it('stopCamera() halts all MediaStream tracks', async () => {
    const stopSpy = vi.fn();
    const stream = makeFakeStream(stopSpy);
    mockGetUserMedia(stream);

    const ref = createRef<ImageCaptureHandle>();
    render(
      <ImageCapture
        ref={ref}
        onImageCaptured={() => {}}
        autoStart
      />,
    );

    await waitFor(() => expect(ref.current).not.toBeNull());

    // Simulate the loadedmetadata path so the stream is wired onto the <video>.
    // (Without this, srcObject hasn't been set yet and stopCamera() is a no-op.)
    const video = document.querySelector('video');
    if (video) {
      (video as HTMLVideoElement & { srcObject: MediaStream | null }).srcObject = stream;
    }

    ref.current?.stopCamera();
    expect(stopSpy).toHaveBeenCalled();
  });
});

describe('ImageCapture getUserMedia constraints', () => {
  it('requests low-res constraints when maxWidth <= 480', async () => {
    const stream = makeFakeStream(vi.fn());
    const spy = mockGetUserMedia(stream);

    render(
      <ImageCapture
        onImageCaptured={() => {}}
        autoStart
        maxWidth={480}
      />,
    );

    await waitFor(() => expect(spy).toHaveBeenCalled());
    const call = spy.mock.calls[0]?.[0] as { video: { width?: { ideal?: number } } };
    expect(call.video.width?.ideal).toBe(640);
  });

  it('requests high-res constraints when maxWidth is unset', async () => {
    const stream = makeFakeStream(vi.fn());
    const spy = mockGetUserMedia(stream);

    render(<ImageCapture onImageCaptured={() => {}} autoStart />);

    await waitFor(() => expect(spy).toHaveBeenCalled());
    const call = spy.mock.calls[0]?.[0] as { video: { width?: { ideal?: number } } };
    expect(call.video.width?.ideal).toBe(1920);
  });
});

describe('ImageCapture capturePhoto downscaling', () => {
  it('passes the quality prop through to canvas.toBlob', async () => {
    const stream = makeFakeStream(vi.fn());
    mockGetUserMedia(stream);

    const toBlobSpy = vi.fn((cb: BlobCallback, _type: string, quality: number) => {
      // Resolve synchronously with a tiny fake blob; quality is what we want to assert
      cb(new Blob([new Uint8Array([0])], { type: 'image/jpeg' }));
      return quality; // returned so TS is happy; not used
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
      configurable: true,
      value: toBlobSpy,
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: () => ({ drawImage: vi.fn() }),
    });

    let captureFn: (() => Promise<Blob | null>) | null = null;
    render(
      <ImageCapture
        onImageCaptured={() => {}}
        autoStart
        maxWidth={480}
        quality={0.6}
        onCaptureRef={(fn) => { captureFn = fn; }}
      />,
    );

    await waitFor(() => expect(captureFn).not.toBeNull());

    // Stub videoWidth/Height so capturePhoto thinks the video is ready.
    const video = document.querySelector('video') as HTMLVideoElement | null;
    if (video) {
      Object.defineProperty(video, 'videoWidth', { configurable: true, value: 1920 });
      Object.defineProperty(video, 'videoHeight', { configurable: true, value: 1080 });
    }

    await captureFn!();

    expect(toBlobSpy).toHaveBeenCalled();
    // toBlob(callback, type, quality) — assert the quality arg
    expect(toBlobSpy.mock.calls[0][2]).toBe(0.6);
  });

  it('downscales the canvas to maxWidth before encoding', async () => {
    const stream = makeFakeStream(vi.fn());
    mockGetUserMedia(stream);

    const drawImage = vi.fn();
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: () => ({ drawImage }),
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
      configurable: true,
      value: (cb: BlobCallback) => cb(new Blob([new Uint8Array([0])], { type: 'image/jpeg' })),
    });

    let captureFn: (() => Promise<Blob | null>) | null = null;
    render(
      <ImageCapture
        onImageCaptured={() => {}}
        autoStart
        maxWidth={480}
        onCaptureRef={(fn) => { captureFn = fn; }}
      />,
    );

    await waitFor(() => expect(captureFn).not.toBeNull());

    const video = document.querySelector('video') as HTMLVideoElement | null;
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
    if (video) {
      Object.defineProperty(video, 'videoWidth', { configurable: true, value: 1920 });
      Object.defineProperty(video, 'videoHeight', { configurable: true, value: 1080 });
    }

    await captureFn!();

    // 480 / 1920 = 0.25 → 1920*0.25 = 480, 1080*0.25 = 270
    expect(canvas?.width).toBe(480);
    expect(canvas?.height).toBe(270);
  });
});
