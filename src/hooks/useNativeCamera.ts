import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

/** Testable helper: convert base64 to Blob */
export function base64ToBlob(base64: string, format: string): Blob {
  if (!base64) return new Blob([], { type: `image/${format}` });
  const byteString = atob(base64);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: `image/${format}` });
}

export function useNativeCamera() {
  const isNative = Capacitor.isNativePlatform();

  async function takePhoto(): Promise<Blob | null> {
    if (!isNative) return null;

    const photo = await Camera.getPhoto({
      quality: 80,
      source: CameraSource.Camera,
      resultType: CameraResultType.Base64,
      width: 480,
    });

    if (!photo.base64String) return null;
    return base64ToBlob(photo.base64String, photo.format);
  }

  return { isNative, takePhoto };
}
