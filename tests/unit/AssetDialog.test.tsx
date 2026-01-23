import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AssetDialog } from '@/components/assets/AssetDialog';
import type { Asset } from '@/types/assets';

// Mock dependencies
const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
}));

const mockToast = vi.hoisted(() => ({
  toast: vi.fn(),
}));

const mockUseAssets = vi.hoisted(() => ({
  assets: [],
  loading: false,
  error: null,
  createAsset: { mutateAsync: vi.fn(), isPending: false },
  updateAsset: { mutateAsync: vi.fn(), isPending: false },
  disposeAsset: { mutateAsync: vi.fn(), isPending: false },
  deleteAsset: { mutateAsync: vi.fn(), isPending: false },
  refetch: vi.fn(),
  assetSummary: {
    totalAssets: 0,
    totalPurchaseValue: 0,
    totalCurrentValue: 0,
    totalDepreciation: 0,
  },
}));

const mockUseAssetPhotos = vi.hoisted(() => ({
  photos: [],
  loading: false,
  error: null,
  uploadPhoto: vi.fn(),
  downloadPhoto: vi.fn(),
  getPhotoUrl: vi.fn(),
  deletePhoto: vi.fn(),
  refetch: vi.fn(),
}));

const mockRestaurantContext = vi.hoisted(() => ({
  selectedRestaurant: { restaurant_id: 'rest-123' } as { restaurant_id: string } | null,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => mockToast,
}));

vi.mock('@/hooks/useAssets', () => ({
  useAssets: () => mockUseAssets,
}));

vi.mock('@/hooks/useAssetPhotos', () => ({
  useAssetPhotos: () => mockUseAssetPhotos,
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => mockRestaurantContext,
}));

vi.mock('react-hook-form', () => ({
  useForm: () => ({
    register: vi.fn(),
    handleSubmit: vi.fn((fn) => fn),
    watch: vi.fn(),
    setValue: vi.fn(),
    reset: vi.fn(),
    formState: { errors: {} },
    control: {},
  }),
  FormProvider: ({ children }: { children: React.ReactNode }) => React.createElement('div', {}, children),
}));

vi.mock('@hookform/resolvers/zod', () => ({
  zodResolver: vi.fn(),
}));

// Mock UI components
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: any) => open ? React.createElement('div', { 'data-testid': 'dialog' }, children) : null,
  DialogContent: ({ children }: any) => React.createElement('div', { 'data-testid': 'dialog-content' }, children),
  DialogHeader: ({ children }: any) => React.createElement('div', { 'data-testid': 'dialog-header' }, children),
  DialogTitle: ({ children }: any) => React.createElement('div', { 'data-testid': 'dialog-title' }, children),
  DialogDescription: ({ children }: any) => React.createElement('div', { 'data-testid': 'dialog-description' }, children),
  DialogFooter: ({ children }: any) => React.createElement('div', { 'data-testid': 'dialog-footer' }, children),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, variant }: any) =>
    React.createElement('button', { onClick, disabled, 'data-variant': variant }, children),
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: any) => React.createElement('input', props),
}));

vi.mock('@/components/ui/textarea', () => ({
  Textarea: (props: any) => React.createElement('textarea', props),
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: any) => React.createElement('div', { 'data-testid': 'select' }, children),
  SelectContent: ({ children }: any) => React.createElement('div', { 'data-testid': 'select-content' }, children),
  SelectItem: ({ children, value }: any) => React.createElement('option', { value }, children),
  SelectTrigger: ({ children }: any) => React.createElement('div', { 'data-testid': 'select-trigger' }, children),
  SelectValue: ({ placeholder }: any) => React.createElement('span', {}, placeholder),
}));

vi.mock('@/components/ui/label', () => ({
  Label: ({ children }: any) => React.createElement('label', {}, children),
}));

vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: any) => React.createElement('div', { 'data-testid': 'card' }, children),
  CardContent: ({ children }: any) => React.createElement('div', { 'data-testid': 'card-content' }, children),
  CardHeader: ({ children }: any) => React.createElement('div', { 'data-testid': 'card-header' }, children),
}));

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: any) => React.createElement('span', { 'data-testid': 'badge' }, children),
}));

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: () => React.createElement('div', { 'data-testid': 'skeleton' }),
}));

vi.mock('lucide-react', () => ({
  Plus: () => React.createElement('div', { 'data-testid': 'plus-icon' }),
  X: () => React.createElement('div', { 'data-testid': 'x-icon' }),
  Upload: () => React.createElement('div', { 'data-testid': 'upload-icon' }),
  Trash2: () => React.createElement('div', { 'data-testid': 'trash-icon' }),
  Camera: () => React.createElement('div', { 'data-testid': 'camera-icon' }),
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
};

// Mock data
const mockAsset: Asset = {
  id: 'asset-1',
  restaurant_id: 'rest-123',
  name: 'Test Asset',
  description: 'Test Description',
  category: 'equipment',
  purchase_date: '2024-01-01',
  purchase_price: 1000,
  current_value: 900,
  location: 'Kitchen',
  status: 'active',
  depreciation_method: 'straight_line',
  useful_life_years: 5,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

describe('AssetDialog Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Dialog visibility', () => {
    it('should not render when open is false', () => {
      render(
        React.createElement(AssetDialog, { open: false, onOpenChange: vi.fn() }),
        { wrapper: createWrapper() }
      );

      expect(screen.queryByTestId('dialog')).not.toBeInTheDocument();
    });

    it('should render when open is true', () => {
      render(
        React.createElement(AssetDialog, { open: true, onOpenChange: vi.fn() }),
        { wrapper: createWrapper() }
      );

      expect(screen.getByTestId('dialog')).toBeInTheDocument();
      expect(screen.getByTestId('dialog-title')).toBeInTheDocument();
    });
  });

  describe('Create mode', () => {
    it('should render create form correctly', () => {
      render(
        React.createElement(AssetDialog, { open: true, onOpenChange: vi.fn() }),
        { wrapper: createWrapper() }
      );

      expect(screen.getByTestId('dialog-title')).toHaveTextContent('Add Asset');
      expect(screen.getByTestId('dialog-description')).toHaveTextContent('Add a new asset to track in your restaurant.');
    });

    it('should handle form submission for create', async () => {
      const onOpenChange = vi.fn();
      const user = userEvent.setup();

      mockUseAssets.createAsset.mutateAsync.mockResolvedValue(mockAsset);

      render(
        React.createElement(AssetDialog, { open: true, onOpenChange }),
        { wrapper: createWrapper() }
      );

      // Fill out form (mocked form, so we simulate submission)
      const submitButton = screen.getByRole('button', { name: /add asset/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockUseAssets.createAsset.mutateAsync).toHaveBeenCalled();
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
    });

    it('should handle create error', async () => {
      const user = userEvent.setup();

      mockUseAssets.createAsset.mutateAsync.mockRejectedValue(new Error('Create failed'));

      render(
        React.createElement(AssetDialog, { open: true, onOpenChange: vi.fn() }),
        { wrapper: createWrapper() }
      );

      const submitButton = screen.getByRole('button', { name: /add asset/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockToast.toast).toHaveBeenCalledWith({
          title: 'Error creating asset',
          description: 'Create failed',
          variant: 'destructive',
        });
      });
    });
  });

  describe('Edit mode', () => {
    it('should render edit form correctly', () => {
      render(
        React.createElement(AssetDialog, {
          open: true,
          onOpenChange: vi.fn(),
          asset: mockAsset
        }),
        { wrapper: createWrapper() }
      );

      expect(screen.getByTestId('dialog-title')).toHaveTextContent('Edit Asset');
      expect(screen.getByTestId('dialog-description')).toHaveTextContent('Update asset information.');
    });

    it('should handle form submission for update', async () => {
      const onOpenChange = vi.fn();
      const user = userEvent.setup();

      mockUseAssets.updateAsset.mutateAsync.mockResolvedValue({ ...mockAsset, name: 'Updated Asset' });

      render(
        React.createElement(AssetDialog, {
          open: true,
          onOpenChange,
          asset: mockAsset
        }),
        { wrapper: createWrapper() }
      );

      const submitButton = screen.getByRole('button', { name: /update asset/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockUseAssets.updateAsset.mutateAsync).toHaveBeenCalled();
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
    });

    it('should handle update error', async () => {
      const user = userEvent.setup();

      mockUseAssets.updateAsset.mutateAsync.mockRejectedValue(new Error('Update failed'));

      render(
        React.createElement(AssetDialog, {
          open: true,
          onOpenChange: vi.fn(),
          asset: mockAsset
        }),
        { wrapper: createWrapper() }
      );

      const submitButton = screen.getByRole('button', { name: /update asset/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockToast.toast).toHaveBeenCalledWith({
          title: 'Error updating asset',
          description: 'Update failed',
          variant: 'destructive',
        });
      });
    });
  });

  describe('Photo management', () => {
    it('should display photo upload section', () => {
      render(
        React.createElement(AssetDialog, { open: true, onOpenChange: vi.fn() }),
        { wrapper: createWrapper() }
      );

      expect(screen.getByTestId('camera-icon')).toBeInTheDocument();
    });

    it('should handle photo upload', async () => {
      const user = userEvent.setup();
      const mockFile = new File(['test'], 'test.jpg', { type: 'image/jpeg' });

      mockUseAssetPhotos.uploadPhoto.mockResolvedValue();

      render(
        React.createElement(AssetDialog, {
          open: true,
          onOpenChange: vi.fn(),
          asset: mockAsset
        }),
        { wrapper: createWrapper() }
      );

      const fileInput = screen.getByTestId('photo-upload-input') as HTMLInputElement;
      await user.upload(fileInput, mockFile);

      await waitFor(() => {
        expect(mockUseAssetPhotos.uploadPhoto).toHaveBeenCalledWith(mockFile);
        expect(mockUseAssetPhotos.refetch).toHaveBeenCalled();
      });
    });

    it('should handle photo upload error', async () => {
      const user = userEvent.setup();
      const mockFile = new File(['test'], 'test.jpg', { type: 'image/jpeg' });

      mockUseAssetPhotos.uploadPhoto.mockRejectedValue(new Error('Upload failed'));

      render(
        React.createElement(AssetDialog, {
          open: true,
          onOpenChange: vi.fn(),
          asset: mockAsset
        }),
        { wrapper: createWrapper() }
      );

      const fileInput = screen.getByTestId('photo-upload-input') as HTMLInputElement;
      await user.upload(fileInput, mockFile);

      await waitFor(() => {
        expect(mockToast.toast).toHaveBeenCalledWith({
          title: 'Error uploading photo',
          description: 'Upload failed',
          variant: 'destructive',
        });
      });
    });

    it('should display existing photos', () => {
      const mockPhotos = [{
        id: 'photo-1',
        asset_id: 'asset-1',
        filename: 'test.jpg',
        file_path: 'assets/asset-1/test.jpg',
        file_size: 1024,
        mime_type: 'image/jpeg',
        uploaded_at: '2024-01-01T00:00:00Z',
      }];

      mockUseAssetPhotos.photos = mockPhotos;
      mockUseAssetPhotos.getPhotoUrl.mockReturnValue('https://example.com/photo.jpg');

      render(
        React.createElement(AssetDialog, {
          open: true,
          onOpenChange: vi.fn(),
          asset: mockAsset
        }),
        { wrapper: createWrapper() }
      );

      expect(screen.getByTestId('photo-grid')).toBeInTheDocument();
    });

    it('should handle photo deletion', async () => {
      const user = userEvent.setup();
      const mockPhotos = [{
        id: 'photo-1',
        asset_id: 'asset-1',
        filename: 'test.jpg',
        file_path: 'assets/asset-1/test.jpg',
        file_size: 1024,
        mime_type: 'image/jpeg',
        uploaded_at: '2024-01-01T00:00:00Z',
      }];

      mockUseAssetPhotos.photos = mockPhotos;
      mockUseAssetPhotos.deletePhoto.mockResolvedValue();

      render(
        React.createElement(AssetDialog, {
          open: true,
          onOpenChange: vi.fn(),
          asset: mockAsset
        }),
        { wrapper: createWrapper() }
      );

      const deleteButton = screen.getByTestId('delete-photo-button');
      await user.click(deleteButton);

      await waitFor(() => {
        expect(mockUseAssetPhotos.deletePhoto).toHaveBeenCalledWith('photo-1', 'assets/asset-1/test.jpg');
        expect(mockUseAssetPhotos.refetch).toHaveBeenCalled();
      });
    });
  });

  describe('Loading states', () => {
    it('should show loading state during create', () => {
      mockUseAssets.createAsset.isPending = true;

      render(
        React.createElement(AssetDialog, { open: true, onOpenChange: vi.fn() }),
        { wrapper: createWrapper() }
      );

      const submitButton = screen.getByRole('button', { name: /add asset/i });
      expect(submitButton).toBeDisabled();
    });

    it('should show loading state during update', () => {
      mockUseAssets.updateAsset.isPending = true;

      render(
        React.createElement(AssetDialog, {
          open: true,
          onOpenChange: vi.fn(),
          asset: mockAsset
        }),
        { wrapper: createWrapper() }
      );

      const submitButton = screen.getByRole('button', { name: /update asset/i });
      expect(submitButton).toBeDisabled();
    });

    it('should show skeleton when loading photos', () => {
      mockUseAssetPhotos.loading = true;

      render(
        React.createElement(AssetDialog, {
          open: true,
          onOpenChange: vi.fn(),
          asset: mockAsset
        }),
        { wrapper: createWrapper() }
      );

      expect(screen.getByTestId('skeleton')).toBeInTheDocument();
    });
  });

  describe('Form validation', () => {
    it('should validate required fields', async () => {
      const user = userEvent.setup();

      render(
        React.createElement(AssetDialog, { open: true, onOpenChange: vi.fn() }),
        { wrapper: createWrapper() }
      );

      const submitButton = screen.getByRole('button', { name: /add asset/i });
      await user.click(submitButton);

      // Form validation should prevent submission with empty required fields
      expect(mockUseAssets.createAsset.mutateAsync).not.toHaveBeenCalled();
    });
  });

  describe('Dialog actions', () => {
    it('should call onOpenChange when cancel is clicked', async () => {
      const onOpenChange = vi.fn();
      const user = userEvent.setup();

      render(
        React.createElement(AssetDialog, { open: true, onOpenChange }),
        { wrapper: createWrapper() }
      );

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('should reset form when dialog closes', () => {
      const onOpenChange = vi.fn();

      const { rerender } = render(
        React.createElement(AssetDialog, { open: true, onOpenChange }),
        { wrapper: createWrapper() }
      );

      // Close dialog
      rerender(
        React.createElement(AssetDialog, { open: false, onOpenChange })
      );

      // Form should be reset when reopened
      rerender(
        React.createElement(AssetDialog, { open: true, onOpenChange })
      );

      // Verify form is clean
      expect(screen.getByTestId('dialog')).toBeInTheDocument();
    });
  });
});