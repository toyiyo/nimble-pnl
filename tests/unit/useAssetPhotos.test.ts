import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAssetPhotos } from '@/hooks/useAssetPhotos';
import type { AssetPhoto } from '@/types/assets';

// Mock Supabase client
const mockSupabase = vi.hoisted(() => ({
  storage: {
    from: vi.fn(),
  },
  from: vi.fn(),
}));

const mockToast = vi.hoisted(() => ({
  toast: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => mockToast,
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
};

// Mock data
const mockPhoto: AssetPhoto = {
  id: 'photo-1',
  asset_id: 'asset-1',
  filename: 'test-photo.jpg',
  file_path: 'assets/asset-1/test-photo.jpg',
  file_size: 1024000,
  mime_type: 'image/jpeg',
  uploaded_at: '2024-01-01T00:00:00Z',
};

const mockPhotos: AssetPhoto[] = [mockPhoto];

// Mock File
const createMockFile = (name: string = 'test.jpg', size: number = 1024, type: string = 'image/jpeg'): File => {
  const file = new File([''], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

describe('useAssetPhotos Hook', () => {
  let mockStorageChain: any;
  let mockFromChain: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock chains
    mockStorageChain = {
      upload: vi.fn().mockReturnThis(),
      download: vi.fn().mockReturnThis(),
      getPublicUrl: vi.fn().mockReturnThis(),
      remove: vi.fn().mockReturnThis(),
      data: null,
      error: null,
    };

    mockFromChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      data: null,
      error: null,
    };

    mockSupabase.storage.from.mockReturnValue(mockStorageChain);
    mockSupabase.from.mockReturnValue(mockFromChain);
  });

  describe('Query functionality', () => {
    it('should fetch photos successfully', async () => {
      mockFromChain.data = mockPhotos;

      const { result } = renderHook(() => useAssetPhotos('asset-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.photos).toEqual(mockPhotos);
        expect(result.current.loading).toBe(false);
        expect(result.current.error).toBe(null);
      });

      expect(mockSupabase.from).toHaveBeenCalledWith('asset_photos');
      expect(mockFromChain.select).toHaveBeenCalled();
      expect(mockFromChain.eq).toHaveBeenCalledWith('asset_id', 'asset-1');
      expect(mockFromChain.order).toHaveBeenCalledWith('uploaded_at', { ascending: false });
    });

    it('should handle loading state', () => {
      mockFromChain.data = null;

      const { result } = renderHook(() => useAssetPhotos('asset-1'), {
        wrapper: createWrapper(),
      });

      expect(result.current.loading).toBe(true);
      expect(result.current.photos).toEqual([]);
    });

    it('should handle error state', async () => {
      mockFromChain.error = new Error('Database error');

      const { result } = renderHook(() => useAssetPhotos('asset-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.error).toBeInstanceOf(Error);
        expect(result.current.error?.message).toBe('Database error');
        expect(result.current.loading).toBe(false);
      });
    });

    it('should return empty array when no assetId provided', async () => {
      const { result } = renderHook(() => useAssetPhotos(null), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.photos).toEqual([]);
        expect(result.current.loading).toBe(false);
      });

      expect(mockSupabase.from).not.toHaveBeenCalled();
    });
  });

  describe('Upload functionality', () => {
    it('should upload photo successfully', async () => {
      const mockFile = createMockFile();
      mockStorageChain.upload.mockResolvedValue({ data: { path: 'assets/asset-1/test.jpg' }, error: null });
      mockFromChain.data = [{ ...mockPhoto, filename: 'test.jpg' }];

      const { result } = renderHook(() => useAssetPhotos('asset-1'), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.uploadPhoto(mockFile);
      });

      expect(mockSupabase.storage.from).toHaveBeenCalledWith('assets');
      expect(mockStorageChain.upload).toHaveBeenCalledWith(
        'assets/asset-1/test.jpg',
        mockFile,
        { upsert: false }
      );
      expect(mockSupabase.from).toHaveBeenCalledWith('asset_photos');
      expect(mockFromChain.insert).toHaveBeenCalledWith({
        asset_id: 'asset-1',
        filename: 'test.jpg',
        file_path: 'assets/asset-1/test.jpg',
        file_size: 1024,
        mime_type: 'image/jpeg',
      });
      expect(mockToast.toast).toHaveBeenCalledWith({
        title: 'Photo uploaded',
        description: 'Photo has been uploaded successfully.',
      });
    });

    it('should handle file validation - file too large', async () => {
      const largeFile = createMockFile('large.jpg', 11 * 1024 * 1024); // 11MB

      const { result } = renderHook(() => useAssetPhotos('asset-1'), {
        wrapper: createWrapper(),
      });

      await expect(result.current.uploadPhoto(largeFile)).rejects.toThrow('File size must be less than 10MB');

      expect(mockSupabase.storage.from).not.toHaveBeenCalled();
      expect(mockToast.toast).toHaveBeenCalledWith({
        title: 'Invalid file',
        description: 'File size must be less than 10MB',
        variant: 'destructive',
      });
    });

    it('should handle file validation - invalid type', async () => {
      const invalidFile = createMockFile('test.txt', 1024, 'text/plain');

      const { result } = renderHook(() => useAssetPhotos('asset-1'), {
        wrapper: createWrapper(),
      });

      await expect(result.current.uploadPhoto(invalidFile)).rejects.toThrow('Only image files are allowed');

      expect(mockSupabase.storage.from).not.toHaveBeenCalled();
      expect(mockToast.toast).toHaveBeenCalledWith({
        title: 'Invalid file',
        description: 'Only image files are allowed',
        variant: 'destructive',
      });
    });

    it('should handle upload error', async () => {
      const mockFile = createMockFile();
      mockStorageChain.upload.mockResolvedValue({ data: null, error: new Error('Upload failed') });

      const { result } = renderHook(() => useAssetPhotos('asset-1'), {
        wrapper: createWrapper(),
      });

      await expect(result.current.uploadPhoto(mockFile)).rejects.toThrow('Upload failed');

      expect(mockToast.toast).toHaveBeenCalledWith({
        title: 'Error uploading photo',
        description: 'Upload failed',
        variant: 'destructive',
      });
    });

    it('should handle database insert error', async () => {
      const mockFile = createMockFile();
      mockStorageChain.upload.mockResolvedValue({ data: { path: 'assets/asset-1/test.jpg' }, error: null });
      mockFromChain.error = new Error('Database insert failed');

      const { result } = renderHook(() => useAssetPhotos('asset-1'), {
        wrapper: createWrapper(),
      });

      await expect(result.current.uploadPhoto(mockFile)).rejects.toThrow('Database insert failed');

      expect(mockToast.toast).toHaveBeenCalledWith({
        title: 'Error uploading photo',
        description: 'Database insert failed',
        variant: 'destructive',
      });
    });
  });

  describe('Download functionality', () => {
    it('should download photo successfully', async () => {
      const mockBlob = new Blob(['test'], { type: 'image/jpeg' });
      mockStorageChain.download.mockResolvedValue({ data: mockBlob, error: null });

      const { result } = renderHook(() => useAssetPhotos('asset-1'), {
        wrapper: createWrapper(),
      });

      const url = await result.current.downloadPhoto('assets/asset-1/test.jpg');

      expect(mockSupabase.storage.from).toHaveBeenCalledWith('assets');
      expect(mockStorageChain.download).toHaveBeenCalledWith('assets/asset-1/test.jpg');
      expect(url).toMatch(/^blob:/);
    });

    it('should handle download error', async () => {
      mockStorageChain.download.mockResolvedValue({ data: null, error: new Error('Download failed') });

      const { result } = renderHook(() => useAssetPhotos('asset-1'), {
        wrapper: createWrapper(),
      });

      await expect(result.current.downloadPhoto('assets/asset-1/test.jpg')).rejects.toThrow('Download failed');

      expect(mockToast.toast).toHaveBeenCalledWith({
        title: 'Error downloading photo',
        description: 'Download failed',
        variant: 'destructive',
      });
    });
  });

  describe('Get signed URL functionality', () => {
    it('should get signed URL successfully', async () => {
      const mockSignedUrl = 'https://signed-url.example.com';
      mockStorageChain.getPublicUrl.mockReturnValue({ data: { publicUrl: mockSignedUrl } });

      const { result } = renderHook(() => useAssetPhotos('asset-1'), {
        wrapper: createWrapper(),
      });

      const url = result.current.getPhotoUrl('assets/asset-1/test.jpg');

      expect(mockSupabase.storage.from).toHaveBeenCalledWith('assets');
      expect(mockStorageChain.getPublicUrl).toHaveBeenCalledWith('assets/asset-1/test.jpg');
      expect(url).toBe(mockSignedUrl);
    });
  });

  describe('Delete functionality', () => {
    it('should delete photo successfully', async () => {
      mockStorageChain.remove.mockResolvedValue({ data: null, error: null });
      mockFromChain.data = null;

      const { result } = renderHook(() => useAssetPhotos('asset-1'), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.deletePhoto('photo-1', 'assets/asset-1/test.jpg');
      });

      expect(mockSupabase.storage.from).toHaveBeenCalledWith('assets');
      expect(mockStorageChain.remove).toHaveBeenCalledWith(['assets/asset-1/test.jpg']);
      expect(mockSupabase.from).toHaveBeenCalledWith('asset_photos');
      expect(mockFromChain.delete).toHaveBeenCalledWith();
      expect(mockFromChain.eq).toHaveBeenCalledWith('id', 'photo-1');
      expect(mockToast.toast).toHaveBeenCalledWith({
        title: 'Photo deleted',
        description: 'Photo has been deleted successfully.',
      });
    });

    it('should handle storage delete error', async () => {
      mockStorageChain.remove.mockResolvedValue({ data: null, error: new Error('Storage delete failed') });

      const { result } = renderHook(() => useAssetPhotos('asset-1'), {
        wrapper: createWrapper(),
      });

      await expect(result.current.deletePhoto('photo-1', 'assets/asset-1/test.jpg')).rejects.toThrow('Storage delete failed');

      expect(mockToast.toast).toHaveBeenCalledWith({
        title: 'Error deleting photo',
        description: 'Storage delete failed',
        variant: 'destructive',
      });
    });

    it('should handle database delete error', async () => {
      mockStorageChain.remove.mockResolvedValue({ data: null, error: null });
      mockFromChain.error = new Error('Database delete failed');

      const { result } = renderHook(() => useAssetPhotos('asset-1'), {
        wrapper: createWrapper(),
      });

      await expect(result.current.deletePhoto('photo-1', 'assets/asset-1/test.jpg')).rejects.toThrow('Database delete failed');

      expect(mockToast.toast).toHaveBeenCalledWith({
        title: 'Error deleting photo',
        description: 'Database delete failed',
        variant: 'destructive',
      });
    });
  });

  describe('Refetch functionality', () => {
    it('should refetch photos', async () => {
      mockFromChain.data = mockPhotos;

      const { result } = renderHook(() => useAssetPhotos('asset-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.photos).toEqual(mockPhotos);
      });

      // Call refetch
      await act(async () => {
        await result.current.refetch();
      });

      // Should have been called twice (initial + refetch)
      expect(mockSupabase.from).toHaveBeenCalledTimes(2);
    });
  });
});