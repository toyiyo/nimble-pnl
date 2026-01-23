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

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: 'rest-123' },
  }),
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

const mockPhotosWithUrl: AssetPhotoWithUrl[] = [{
  ...mockPhoto,
  signedUrl: 'https://signed-url.example.com',
}];

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
      upload: vi.fn(),
      download: vi.fn(),
      getPublicUrl: vi.fn(),
      createSignedUrl: vi.fn(),
      remove: vi.fn(),
    };

    mockFromChain = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      insert: vi.fn(),
      delete: vi.fn(),
      single: vi.fn(),
    };

    mockSupabase.storage.from.mockReturnValue(mockStorageChain);
    mockSupabase.from.mockReturnValue(mockFromChain);
  });

  describe('Query functionality', () => {
    it('should fetch photos successfully', async () => {
      // Mock the chain: from -> select -> eq -> eq -> order -> order
      mockFromChain.select.mockReturnValue(mockFromChain);
      mockFromChain.eq.mockReturnValueOnce(mockFromChain); // asset_id eq
      mockFromChain.eq.mockReturnValueOnce(mockFromChain); // restaurant_id eq
      mockFromChain.order.mockReturnValueOnce(mockFromChain); // is_primary order
      mockFromChain.order.mockReturnValueOnce({ data: mockPhotos, error: null }); // created_at order

      // Mock signed URL creation
      mockStorageChain.createSignedUrl.mockResolvedValue({
        data: { signedUrl: 'https://signed-url.example.com' },
        error: null
      });

      const { result } = renderHook(() => useAssetPhotos({ assetId: 'asset-1' }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.photos).toEqual(mockPhotosWithUrl);
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockSupabase.from).toHaveBeenCalledWith('asset_photos');
      expect(mockFromChain.select).toHaveBeenCalled();
      expect(mockFromChain.eq).toHaveBeenCalledWith('asset_id', 'asset-1');
      expect(mockFromChain.order).toHaveBeenCalledWith('is_primary', { ascending: false });
      expect(mockFromChain.order).toHaveBeenCalledWith('created_at', { ascending: false });
    });

    it('should handle loading state', () => {
      mockFromChain.data = null;

      const { result } = renderHook(() => useAssetPhotos({ assetId: 'asset-1' }), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(true);
      expect(result.current.photos).toEqual([]);
    });

    it('should handle error state', async () => {
      mockFromChain.error = new Error('Database error');

      const { result } = renderHook(() => useAssetPhotos({ assetId: 'asset-1' }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });

    it('should return empty array when no assetId provided', async () => {
      const { result } = renderHook(() => useAssetPhotos({ assetId: null }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.photos).toEqual([]);
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockSupabase.from).not.toHaveBeenCalled();
    });
  });

  describe('Upload functionality', () => {
    it('should upload photo successfully', async () => {
      const mockFile = createMockFile();
      mockStorageChain.upload.mockResolvedValue({ data: { path: 'assets/asset-1/test.jpg' }, error: null });
      mockFromChain.insert.mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { ...mockPhoto, file_name: 'test.jpg' },
            error: null,
          }),
        }),
      });
      mockStorageChain.createSignedUrl.mockResolvedValue({
        data: { signedUrl: 'https://signed-url.example.com' },
        error: null,
      });

      const { result } = renderHook(() => useAssetPhotos({ assetId: 'asset-1' }), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.uploadPhoto(mockFile);
      });

      expect(mockSupabase.storage.from).toHaveBeenCalledWith('asset-images');
      expect(mockStorageChain.upload).toHaveBeenCalledWith(
        expect.stringMatching(/^rest-123\/assets\/asset-1\/\d+-test\.jpg$/),
        mockFile
      );
      expect(mockSupabase.from).toHaveBeenCalledWith('asset_photos');
      expect(mockFromChain.insert).toHaveBeenCalledWith({
        asset_id: 'asset-1',
        restaurant_id: 'rest-123',
        storage_path: expect.stringMatching(/^rest-123\/assets\/asset-1\/\d+-test\.jpg$/),
        file_name: 'test.jpg',
        file_size: 1024,
        mime_type: 'image/jpeg',
        is_primary: true,
      });
      expect(mockToast.toast).toHaveBeenCalledWith({
        title: 'Photo uploaded',
        description: 'The photo has been added to the asset.',
      });
    });

    it('should handle file validation - file too large', async () => {
      const largeFile = createMockFile('large.jpg', 11 * 1024 * 1024); // 11MB

      const { result } = renderHook(() => useAssetPhotos({ assetId: 'asset-1' }), {
        wrapper: createWrapper(),
      });

      const uploadResult = await result.current.uploadPhoto(largeFile);
      expect(uploadResult).toBeNull();

      expect(mockSupabase.storage.from).not.toHaveBeenCalled();
      expect(mockToast.toast).toHaveBeenCalledWith({
        title: 'File Too Large',
        description: 'Your file is 11.00MB. Maximum size is 10MB.',
        variant: 'destructive',
      });
    });

    it('should handle file validation - invalid type', async () => {
      const invalidFile = createMockFile('test.txt', 1024, 'text/plain');

      const { result } = renderHook(() => useAssetPhotos({ assetId: 'asset-1' }), {
        wrapper: createWrapper(),
      });

      const uploadResult = await result.current.uploadPhoto(invalidFile);
      expect(uploadResult).toBeNull();

      expect(mockSupabase.storage.from).not.toHaveBeenCalled();
      expect(mockToast.toast).toHaveBeenCalledWith({
        title: 'Unsupported file',
        description: 'Please upload an image file (JPG, PNG, etc).',
        variant: 'destructive',
      });
    });

    it('should handle upload error', async () => {
      const mockFile = createMockFile();
      mockStorageChain.upload.mockResolvedValue({ data: null, error: new Error('Upload failed') });

      const { result } = renderHook(() => useAssetPhotos({ assetId: 'asset-1' }), {
        wrapper: createWrapper(),
      });

      const uploadResult = await result.current.uploadPhoto(mockFile);
      expect(uploadResult).toBeNull();

      expect(mockToast.toast).toHaveBeenCalledWith({
        title: 'Upload failed',
        description: 'Failed to upload the photo. Please try again.',
        variant: 'destructive',
      });
    });

    it('should handle database insert error', async () => {
      const mockFile = createMockFile();
      mockStorageChain.upload.mockResolvedValue({ data: { path: 'assets/asset-1/test.jpg' }, error: null });
      mockFromChain.error = new Error('Database insert failed');

      const { result } = renderHook(() => useAssetPhotos({ assetId: 'asset-1' }), {
        wrapper: createWrapper(),
      });

      const uploadResult = await result.current.uploadPhoto(mockFile);
      expect(uploadResult).toBeNull();

      expect(mockToast.toast).toHaveBeenCalledWith({
        title: 'Upload failed',
        description: 'Failed to upload the photo. Please try again.',
        variant: 'destructive',
      });
    });
  });

  describe('Download functionality', () => {
    it('should download photo successfully', async () => {
      const mockBlob = new Blob(['test'], { type: 'image/jpeg' });
      mockStorageChain.download.mockResolvedValue({ data: mockBlob, error: null });

      const { result } = renderHook(() => useAssetPhotos({ assetId: 'asset-1' }), {
        wrapper: createWrapper(),
      });

      const mockPhoto = { ...mockPhotosWithUrl[0], storage_path: 'assets/asset-1/test.jpg' };
      await result.current.downloadPhoto(mockPhoto);

      expect(mockSupabase.storage.from).toHaveBeenCalledWith('asset-images');
      expect(mockStorageChain.download).toHaveBeenCalledWith('assets/asset-1/test.jpg');
    });

    it('should handle download error', async () => {
      mockStorageChain.download.mockResolvedValue({ data: null, error: new Error('Download failed') });

      const { result } = renderHook(() => useAssetPhotos({ assetId: 'asset-1' }), {
        wrapper: createWrapper(),
      });

      const mockPhoto = { ...mockPhotosWithUrl[0], storage_path: 'assets/asset-1/test.jpg' };
      await result.current.downloadPhoto(mockPhoto);

      expect(mockToast.toast).toHaveBeenCalledWith({
        title: 'Download failed',
        description: 'Failed to download the photo.',
        variant: 'destructive',
      });
    });
  });

  describe('Delete functionality', () => {
    it('should delete photo successfully', async () => {
      mockStorageChain.remove.mockResolvedValue({ data: null, error: null });
      
      // Mock the select query chain for fetching photo data
      const mockSelectChain = {
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ 
            data: { storage_path: 'assets/asset-1/test.jpg', is_primary: false }, 
            error: null 
          }),
        }),
      };
      mockFromChain.select.mockReturnValue(mockSelectChain);
      
      // Mock the delete chain
      const mockDeleteChain = {
        eq: vi.fn().mockResolvedValue({ error: null }),
      };
      mockFromChain.delete.mockReturnValue(mockDeleteChain);

      const { result } = renderHook(() => useAssetPhotos({ assetId: 'asset-1' }), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.deletePhoto('photo-1');
      });

      expect(mockSupabase.storage.from).toHaveBeenCalledWith('asset-images');
      expect(mockStorageChain.remove).toHaveBeenCalledWith(['assets/asset-1/test.jpg']);
      expect(mockSupabase.from).toHaveBeenCalledWith('asset_photos');
      expect(mockFromChain.select).toHaveBeenCalledWith('storage_path, is_primary');
      expect(mockSelectChain.eq).toHaveBeenCalledWith('id', 'photo-1');
      expect(mockSelectChain.eq().single).toHaveBeenCalled();
      expect(mockFromChain.delete).toHaveBeenCalledWith();
      expect(mockDeleteChain.eq).toHaveBeenCalledWith('id', 'photo-1');
      expect(mockToast.toast).toHaveBeenCalledWith({
        title: 'Photo deleted',
        description: 'The photo has been removed.',
      });
    });

    it('should handle storage delete error', async () => {
      mockStorageChain.remove.mockResolvedValue({ data: null, error: new Error('Storage delete failed') });
      
      // Mock the select query chain for fetching photo data
      mockFromChain.select.mockReturnValue(mockFromChain);
      mockFromChain.eq.mockReturnValue(mockFromChain);
      mockFromChain.single.mockReturnValue({ data: { storage_path: 'assets/asset-1/test.jpg', is_primary: false }, error: null });

      const { result } = renderHook(() => useAssetPhotos({ assetId: 'asset-1' }), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.deletePhoto('photo-1');
      });

      expect(mockToast.toast).toHaveBeenCalledWith({
        title: 'Error',
        description: 'Failed to delete the photo.',
        variant: 'destructive',
      });
    });

    it('should handle database delete error', async () => {
      mockStorageChain.remove.mockResolvedValue({ data: null, error: null });
      mockFromChain.data = { storage_path: 'assets/asset-1/test.jpg', is_primary: false };
      // Mock the delete operation to fail
      const mockDeleteChain = { eq: vi.fn().mockReturnThis(), error: new Error('Database delete failed') };
      mockFromChain.delete.mockReturnValue(mockDeleteChain);

      const { result } = renderHook(() => useAssetPhotos({ assetId: 'asset-1' }), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.deletePhoto('photo-1');
      });

      expect(mockToast.toast).toHaveBeenCalledWith({
        title: 'Error',
        description: 'Failed to delete the photo.',
        variant: 'destructive',
      });
    });
  });
});