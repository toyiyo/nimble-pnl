import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import type { AssetPhoto } from '@/types/assets';

const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

export interface AssetPhotoWithUrl extends AssetPhoto {
  signedUrl: string;
}

interface UseAssetPhotosOptions {
  assetId: string | null;
}

export function useAssetPhotos({ assetId }: UseAssetPhotosOptions) {
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id;

  // Fetch photos for the asset
  const { data: rawPhotos = [], isLoading: isLoadingPhotos } = useQuery({
    queryKey: ['asset-photos', assetId, restaurantId],
    queryFn: async () => {
      if (!assetId || !restaurantId) return [];

      const { data, error } = await supabase
        .from('asset_photos')
        .select('*')
        .eq('asset_id', assetId)
        .eq('restaurant_id', restaurantId)
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as AssetPhoto[];
    },
    enabled: !!assetId && !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  // Get signed URLs for photos
  const { data: photos = [], isLoading: isLoadingUrls } = useQuery({
    queryKey: ['asset-photo-urls', rawPhotos.map((p) => p.id).join(',')],
    queryFn: async () => {
      const result: AssetPhotoWithUrl[] = [];

      for (const photo of rawPhotos) {
        try {
          const { data: signedUrlData } = await supabase.storage
            .from('asset-images')
            .createSignedUrl(photo.storage_path, 3600);

          if (signedUrlData?.signedUrl) {
            result.push({
              ...photo,
              signedUrl: signedUrlData.signedUrl,
            });
          }
        } catch (error) {
          console.error('Failed to get signed URL for photo:', photo.id, error);
        }
      }

      return result;
    },
    enabled: rawPhotos.length > 0,
    staleTime: 3000000, // 50 minutes (signed URLs valid for 1 hour)
  });

  // Get primary photo
  const primaryPhoto = useMemo(() => {
    return photos.find((p) => p.is_primary) || photos[0] || null;
  }, [photos]);

  // Upload a new photo
  const uploadPhoto = useCallback(
    async (file: File, isPrimary = false): Promise<AssetPhotoWithUrl | null> => {
      if (!restaurantId || !assetId) {
        toast({
          title: 'Error',
          description: 'Please select a restaurant and asset first',
          variant: 'destructive',
        });
        return null;
      }

      const isImage = file.type.startsWith('image/');

      if (!isImage) {
        toast({
          title: 'Unsupported file',
          description: 'Please upload an image file (JPG, PNG, etc).',
          variant: 'destructive',
        });
        return null;
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
        toast({
          title: 'File Too Large',
          description: `Your file is ${fileSizeMB}MB. Maximum size is ${MAX_FILE_SIZE_MB}MB.`,
          variant: 'destructive',
        });
        return null;
      }

      setIsUploading(true);

      try {
        // Generate unique file path
        const fileExt = file.name.includes('.') ? file.name.split('.').pop() : 'jpg';
        const sanitizedBaseName = file.name
          .replace(fileExt ? `.${fileExt}` : '', '')
          .replace(/[^a-zA-Z0-9_-]/g, '_');
        const finalFileName = `${Date.now()}-${sanitizedBaseName}.${fileExt}`;
        const filePath = `${restaurantId}/assets/${assetId}/${finalFileName}`;

        // Upload to storage
        const { error: uploadError } = await supabase.storage
          .from('asset-images')
          .upload(filePath, file);

        if (uploadError) throw uploadError;

        // If this is the first photo or isPrimary, make it primary
        const shouldBePrimary = isPrimary || rawPhotos.length === 0;

        // Create database record
        const { data: photoData, error: photoError } = await supabase
          .from('asset_photos')
          .insert({
            asset_id: assetId,
            restaurant_id: restaurantId,
            storage_path: filePath,
            file_name: file.name,
            file_size: file.size,
            mime_type: file.type,
            is_primary: shouldBePrimary,
          })
          .select()
          .single();

        if (photoError) throw photoError;

        // Get signed URL
        const { data: signedUrlData } = await supabase.storage
          .from('asset-images')
          .createSignedUrl(filePath, 3600);

        // Invalidate queries
        queryClient.invalidateQueries({ queryKey: ['asset-photos', assetId] });
        queryClient.invalidateQueries({ queryKey: ['assets'] });

        toast({
          title: 'Photo uploaded',
          description: 'The photo has been added to the asset.',
        });

        return {
          ...(photoData as AssetPhoto),
          signedUrl: signedUrlData?.signedUrl || '',
        };
      } catch (error) {
        console.error('Error uploading photo:', error);
        toast({
          title: 'Upload failed',
          description: 'Failed to upload the photo. Please try again.',
          variant: 'destructive',
        });
        return null;
      } finally {
        setIsUploading(false);
      }
    },
    [restaurantId, assetId, rawPhotos.length, toast, queryClient]
  );

  // Delete a photo
  const deletePhoto = useMutation({
    mutationFn: async (photoId: string) => {
      // Get the photo to find storage path
      const { data: photo, error: fetchError } = await supabase
        .from('asset_photos')
        .select('storage_path, is_primary')
        .eq('id', photoId)
        .single();

      if (fetchError) throw fetchError;

      // Delete from storage
      if (photo?.storage_path) {
        await supabase.storage.from('asset-images').remove([photo.storage_path]);
      }

      // Delete database record
      const { error: deleteError } = await supabase
        .from('asset_photos')
        .delete()
        .eq('id', photoId);

      if (deleteError) throw deleteError;

      return photo?.is_primary;
    },
    onSuccess: (wasPrimary) => {
      queryClient.invalidateQueries({ queryKey: ['asset-photos', assetId] });
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      toast({
        title: 'Photo deleted',
        description: wasPrimary
          ? 'Primary photo removed. Another photo will become primary if available.'
          : 'The photo has been removed.',
      });
    },
    onError: (error) => {
      console.error('Error deleting photo:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete the photo.',
        variant: 'destructive',
      });
    },
  });

  // Set a photo as primary
  const setPrimaryPhoto = useMutation({
    mutationFn: async (photoId: string) => {
      // The trigger will automatically unset other primary photos
      const { error } = await supabase
        .from('asset_photos')
        .update({ is_primary: true })
        .eq('id', photoId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-photos', assetId] });
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      toast({
        title: 'Primary photo set',
        description: 'The primary photo has been updated.',
      });
    },
    onError: (error) => {
      console.error('Error setting primary photo:', error);
      toast({
        title: 'Error',
        description: 'Failed to set primary photo.',
        variant: 'destructive',
      });
    },
  });

  // Update photo caption
  const updateCaption = useMutation({
    mutationFn: async ({ photoId, caption }: { photoId: string; caption: string }) => {
      const { error } = await supabase
        .from('asset_photos')
        .update({ caption })
        .eq('id', photoId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-photos', assetId] });
    },
    onError: (error) => {
      console.error('Error updating caption:', error);
      toast({
        title: 'Error',
        description: 'Failed to update caption.',
        variant: 'destructive',
      });
    },
  });

  // Download a photo
  const downloadPhoto = useCallback(
    async (photo: AssetPhotoWithUrl) => {
      try {
        const { data, error } = await supabase.storage
          .from('asset-images')
          .download(photo.storage_path);

        if (error || !data) {
          throw new Error('Failed to download file');
        }

        const blobUrl = URL.createObjectURL(data);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = photo.file_name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      } catch (error) {
        console.error('Error downloading photo:', error);
        toast({
          title: 'Download failed',
          description: 'Failed to download the photo.',
          variant: 'destructive',
        });
      }
    },
    [toast]
  );

  const isLoading = isLoadingPhotos || isLoadingUrls;

  return {
    photos,
    primaryPhoto,
    isLoading,
    isUploading,
    uploadPhoto,
    deletePhoto: deletePhoto.mutate,
    setPrimaryPhoto: setPrimaryPhoto.mutate,
    updateCaption: updateCaption.mutate,
    downloadPhoto,
    hasPhotos: photos.length > 0,
    photoCount: photos.length,
  };
}
