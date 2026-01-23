import { useState, useEffect, useCallback, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { ImageViewer } from '@/components/attachments/ImageViewer';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectSeparator,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, ChevronDown, Upload, X, Star, Trash2, ImageIcon } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useAssetPhotos, type AssetPhotoWithUrl } from '@/hooks/useAssetPhotos';
import type { Asset, AssetFormData } from '@/types/assets';
import { DEFAULT_ASSET_CATEGORIES, getDefaultUsefulLife, formatAssetCurrency } from '@/types/assets';

interface AssetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset: Asset | null;
  onSave: (data: AssetFormData) => Promise<Asset | void>;
  isSaving: boolean;
}

export function AssetDialog(props: AssetDialogProps) {
  const { open, onOpenChange, asset, onSave, isSaving } = props;
  const queryClient = useQueryClient();
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id;

  // State for add location dialog
  const [addLocationOpen, setAddLocationOpen] = useState(false);
  const [newLocationName, setNewLocationName] = useState('');
  const [addingLocation, setAddingLocation] = useState(false);

  // State for pending photos (for new assets)
  const [pendingPhotos, setPendingPhotos] = useState<File[]>([]);

  // State for image viewer dialog
  const [imageViewerOpen, setImageViewerOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState<{
    src: string;
    alt: string;
    isPending?: boolean;
  } | null>(null);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activeTab, setActiveTab] = useState('details');

  const handleAddLocation = async () => {
    if (!newLocationName.trim() || !restaurantId) return;
    setAddingLocation(true);
    const { error } = await supabase
      .from('inventory_locations')
      .insert({ name: newLocationName.trim(), restaurant_id: restaurantId });
    setAddingLocation(false);
    if (!error) {
      setAddLocationOpen(false);
      setNewLocationName('');
      await queryClient.invalidateQueries({ queryKey: ['inventory-locations', restaurantId] as const });
    }
  };

  // Image viewer handlers
  const handleViewImage = useCallback((src: string, alt: string, isPending = false) => {
    setSelectedImage({ src, alt, isPending });
    setImageViewerOpen(true);
  }, []);

  const handleCloseImageViewer = useCallback(() => {
    setImageViewerOpen(false);
    setSelectedImage(null);
  }, []);

  const form = useForm<AssetFormData>({
    defaultValues: {
      name: '',
      description: '',
      category: '',
      serial_number: '',
      purchase_date: new Date().toISOString().split('T')[0],
      purchase_cost: 0,
      salvage_value: 0,
      useful_life_months: 60,
      location_id: '',
      asset_account_id: '',
      accumulated_depreciation_account_id: '',
      depreciation_expense_account_id: '',
      notes: '',
    },
  });

  // Photo management (only for existing assets)
  const {
    photos,
    isLoading: isLoadingPhotos,
    isUploading,
    uploadPhoto,
    deletePhoto,
    setPrimaryPhoto,
  } = useAssetPhotos({ assetId: asset?.id || null });

  // Standalone photo upload function for new assets
  const uploadPhotoForAsset = useCallback(async (file: File, assetId: string) => {
    const restaurantId = selectedRestaurant?.restaurant_id;

    if (!restaurantId) {
      throw new Error('No restaurant selected');
    }

    const isImage = file.type.startsWith('image/');
    if (!isImage) {
      throw new Error('Please upload an image file (JPG, PNG, etc).');
    }

    const MAX_FILE_SIZE_MB = 10;
    const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE_BYTES) {
      const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
      throw new Error(`File is ${fileSizeMB}MB. Maximum size is ${MAX_FILE_SIZE_MB}MB.`);
    }

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
        is_primary: true, // First photo is primary
      })
      .select()
      .single();

    if (photoError) throw photoError;

    return photoData;
  }, [selectedRestaurant]);

  // Fetch locations
  const { data: locations = [] } = useQuery({
    queryKey: ['inventory-locations', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];
      const { data, error } = await supabase
        .from('inventory_locations')
        .select('id, name')
        .eq('restaurant_id', restaurantId)
        .order('name');
      if (error) throw error;
      return data;
    },
    enabled: !!restaurantId,
  });

  // Fetch chart of accounts for asset-related accounts
  const { data: accounts = [] } = useQuery({
    queryKey: ['chart-of-accounts-assets', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];
      // Use .in for multiple subtypes, not .eq
      const { data, error } = await supabase
        .from('chart_of_accounts')
        .select('id, account_code, account_name, account_type, account_subtype')
        .eq('restaurant_id', restaurantId)
        .in('account_subtype', ['fixed_assets', 'accumulated_depreciation', 'depreciation'])
        .order('account_code', { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!restaurantId && showAdvanced,
  });

  // Reset form when asset changes
  useEffect(() => {
    if (asset) {
      form.reset({
        name: asset.name,
        description: asset.description || '',
        category: asset.category,
        serial_number: asset.serial_number || '',
        purchase_date: asset.purchase_date,
        purchase_cost: asset.purchase_cost,
        salvage_value: asset.salvage_value,
        useful_life_months: asset.useful_life_months,
        location_id: asset.location_id || '',
        asset_account_id: asset.asset_account_id || '',
        accumulated_depreciation_account_id: asset.accumulated_depreciation_account_id || '',
        depreciation_expense_account_id: asset.depreciation_expense_account_id || '',
        notes: asset.notes || '',
      });
      // Show advanced if accounting settings are configured
      if (asset.asset_account_id || asset.accumulated_depreciation_account_id) {
        setShowAdvanced(true);
      }
    } else {
      form.reset();
      setShowAdvanced(false);
    }
    setActiveTab('details');
  }, [asset, form]);

  // Auto-set useful life when category changes
  const watchCategory = form.watch('category');
  useEffect(() => {
    if (watchCategory && !asset) {
      const defaultLife = getDefaultUsefulLife(watchCategory);
      form.setValue('useful_life_months', defaultLife);
    }
  }, [watchCategory, asset, form]);

  // Cache blob URLs for pending photos to prevent memory leaks
  const pendingPhotoUrls = useMemo(() => {
    return pendingPhotos.map(file => URL.createObjectURL(file));
  }, [pendingPhotos]);

  // Cleanup blob URLs when pendingPhotos changes or component unmounts
  useEffect(() => {
    const currentUrls = pendingPhotoUrls;
    return () => {
      currentUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [pendingPhotoUrls]);

  // Photo upload dropzone
  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (!acceptedFiles.length) return;

      if (asset?.id) {
        // Existing asset: upload immediately
        for (const file of acceptedFiles) {
          try {
            await uploadPhotoForAsset(file, asset.id);
          } catch (error) {
            console.error('Failed to upload photo:', error);
            toast.error(`Failed to upload ${file.name}. Please try again.`);
          }
        }
      } else {
        // New asset: store for later upload
        setPendingPhotos(prev => [...prev, ...acceptedFiles]);
      }
    },
    [asset?.id, uploadPhotoForAsset]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
    },
    disabled: isUploading,
  });

  const handleSubmit = async (data: AssetFormData) => {
    try {
      const savedAsset = await onSave(data);

      // Close dialog on successful save
      onOpenChange(false);

      // Upload pending photos for new assets
      if (savedAsset && pendingPhotos.length > 0) {
        const photoCount = pendingPhotos.length;
        try {
          for (const file of pendingPhotos) {
            await uploadPhotoForAsset(file, savedAsset.id);
          }
          setPendingPhotos([]);
          toast.success(`${photoCount} photo(s) added to asset.`);
        } catch (error) {
          console.error('Failed to upload pending photos:', error);
          toast.error('Asset was saved but some photos failed to upload.');
        }
      }
    } catch (error) {
      console.error('Failed to save asset:', error);
      toast.error('Failed to save asset. Please try again.');
    }
  };

  const isEditing = !!asset;
  const purchaseCost = form.watch('purchase_cost');
  const salvageValue = form.watch('salvage_value');
  const usefulLifeMonths = form.watch('useful_life_months');

  // Calculate preview depreciation
  const depreciableAmount = purchaseCost - salvageValue;
  const monthlyDepreciation = usefulLifeMonths > 0 ? depreciableAmount / usefulLifeMonths : 0;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{isEditing ? 'Edit Asset' : 'Add New Asset'}</SheetTitle>
            <SheetDescription>
              {isEditing
                ? 'Update asset details and manage photos.'
                : 'Enter the details for the new asset.'}
            </SheetDescription>
          </SheetHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-6">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="photos">
              Photos {(photos.length > 0 || pendingPhotos.length > 0) && `(${photos.length + pendingPhotos.length})`}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="mt-4">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
                {/* Basic Information */}
                <div className="space-y-4">
                  <h3 className="text-sm font-medium text-muted-foreground">Basic Information</h3>

                  <FormField
                    control={form.control}
                    name="name"
                    rules={{ required: 'Name is required' }}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Asset Name</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., Walk-in Refrigerator" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="category"
                      rules={{ required: 'Category is required' }}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Category</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select category" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {DEFAULT_ASSET_CATEGORIES.map((cat) => (
                                <SelectItem key={cat.name} value={cat.name}>
                                  {cat.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="serial_number"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Serial Number</FormLabel>
                          <FormControl>
                            <Input placeholder="Optional" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="location_id"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Location</FormLabel>
                        <div className="flex gap-2 items-center">
                          <Select onValueChange={val => {
                            if (val === '__add_location__') {
                              setAddLocationOpen(true);
                            } else {
                              field.onChange(val);
                            }
                          }} value={field.value || ''}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select location (optional)" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {locations.length === 0 ? (
                                <SelectItem value="no_locations" disabled>No locations available</SelectItem>
                              ) : (
                                <>
                                  <SelectItem value="none">No location</SelectItem>
                                  {locations
                                    .filter((loc) => typeof loc.id === 'string' && loc.id.trim() !== '')
                                    .map((loc) => (
                                      <SelectItem key={loc.id} value={loc.id}>
                                        {loc.name}
                                      </SelectItem>
                                    ))}
                                  <SelectSeparator />
                                  <SelectItem value="__add_location__" className="text-primary cursor-pointer" aria-label="Add new location">
                                    + Add new location
                                  </SelectItem>
                                </>
                              )}
                            </SelectContent>
                          </Select>
                          <Dialog open={addLocationOpen} onOpenChange={setAddLocationOpen}>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Add New Location</DialogTitle>
                                <DialogDescription>Enter a name for the new inventory location.</DialogDescription>
                              </DialogHeader>
                              <Input
                                autoFocus
                                value={newLocationName}
                                onChange={e => setNewLocationName(e.target.value)}
                                placeholder="e.g. Walk-in Freezer"
                                aria-label="Location name"
                                onKeyDown={e => {
                                  if (e.key === 'Enter') handleAddLocation();
                                }}
                                disabled={addingLocation}
                              />
                              <DialogFooter>
                                <Button
                                  type="button"
                                  onClick={handleAddLocation}
                                  disabled={!newLocationName.trim() || addingLocation}
                                  aria-label="Save location"
                                >
                                  {addingLocation ? 'Saving...' : 'Save'}
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Optional description or notes about the asset"
                            className="resize-none"
                            rows={2}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Financial Details */}
                <div className="space-y-4">
                  <h3 className="text-sm font-medium text-muted-foreground">Financial Details</h3>

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="purchase_date"
                      rules={{ required: 'Purchase date is required' }}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Purchase Date</FormLabel>
                          <FormControl>
                            <Input type="date" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="purchase_cost"
                      rules={{
                        required: 'Purchase cost is required',
                        min: { value: 0.01, message: 'Cost must be greater than 0' },
                      }}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Purchase Cost</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="0.00"
                              {...field}
                              onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="salvage_value"
                      rules={{
                        min: { value: 0, message: 'Salvage value cannot be negative' },
                      }}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Salvage Value</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="0.00"
                              {...field}
                              onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                            />
                          </FormControl>
                          <FormDescription>Estimated value at end of useful life</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="useful_life_months"
                      rules={{
                        required: 'Useful life is required',
                        min: { value: 1, message: 'Must be at least 1 month' },
                      }}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Useful Life (Months)</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min="1"
                              {...field}
                              onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                            />
                          </FormControl>
                          <FormDescription>
                            {Math.floor((field.value || 0) / 12)} years, {(field.value || 0) % 12}{' '}
                            months
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Depreciation Preview */}
                  {purchaseCost > 0 && (
                    <div className="rounded-lg bg-muted p-4 space-y-2">
                      <h4 className="text-sm font-medium">Depreciation Preview</h4>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">Depreciable Amount:</span>
                          <span className="ml-2 font-mono">
                            {formatAssetCurrency(depreciableAmount)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Monthly Depreciation:</span>
                          <span className="ml-2 font-mono">
                            {formatAssetCurrency(monthlyDepreciation)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Advanced Settings (Accounting) */}
                <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" className="w-full justify-between">
                      <span>Accounting Settings</span>
                      <ChevronDown
                        className={`h-4 w-4 transition-transform ${
                          showAdvanced ? 'rotate-180' : ''
                        }`}
                      />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-4 pt-4">
                    <FormField
                      control={form.control}
                      name="asset_account_id"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Asset Account</FormLabel>
                          <Select onValueChange={val => field.onChange(val === 'none' ? '' : val)} value={field.value || 'none'}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select asset account" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {accounts.filter((a) => a.account_subtype === 'fixed_assets').length === 0 ? (
                                <SelectItem value="no_accounts" disabled>No asset accounts</SelectItem>
                              ) : (
                                <>
                                  <SelectItem value="none">None</SelectItem>
                                  {accounts
                                    .filter((a) => a.account_subtype === 'fixed_assets' && typeof a.id === 'string' && a.id.trim() !== '')
                                    .map((acc) => (
                                      <SelectItem key={acc.id} value={acc.id}>
                                        {acc.account_code} - {acc.account_name}
                                      </SelectItem>
                                    ))}
                                </>
                              )}
                            </SelectContent>
                          </Select>
                          <FormDescription>Debit account for asset value</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="accumulated_depreciation_account_id"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Accumulated Depreciation Account</FormLabel>
                          <Select onValueChange={val => field.onChange(val === 'none' ? '' : val)} value={field.value || 'none'}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select account" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {accounts.filter((a) => a.account_subtype === 'accumulated_depreciation').length === 0 ? (
                                <SelectItem value="no_accounts" disabled>No accumulated depreciation accounts</SelectItem>
                              ) : (
                                <>
                                  <SelectItem value="none">None</SelectItem>
                                  {accounts
                                    .filter((a) => a.account_subtype === 'accumulated_depreciation' && typeof a.id === 'string' && a.id.trim() !== '')
                                    .map((acc) => (
                                      <SelectItem key={acc.id} value={acc.id}>
                                        {acc.account_code} - {acc.account_name}
                                      </SelectItem>
                                    ))}
                                </>
                              )}
                            </SelectContent>
                          </Select>
                          <FormDescription>Credit account for accumulated depreciation</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="depreciation_expense_account_id"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Depreciation Expense Account</FormLabel>
                          <Select onValueChange={val => field.onChange(val === 'none' ? '' : val)} value={field.value || 'none'}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select expense account" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {accounts.filter((a) => a.account_subtype === 'depreciation').length === 0 ? (
                                <SelectItem value="no_accounts" disabled>No depreciation expense accounts</SelectItem>
                              ) : (
                                <>
                                  <SelectItem value="none">None</SelectItem>
                                  {accounts
                                    .filter((a) => a.account_subtype === 'depreciation' && typeof a.id === 'string' && a.id.trim() !== '')
                                    .map((acc) => (
                                      <SelectItem key={acc.id} value={acc.id}>
                                        {acc.account_code} - {acc.account_name}
                                      </SelectItem>
                                    ))}
                                </>
                              )}
                            </SelectContent>
                          </Select>
                          <FormDescription>Debit account for depreciation expense</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Notes</FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder="Additional notes..."
                              className="resize-none"
                              rows={3}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </CollapsibleContent>
                </Collapsible>

                <div className="flex justify-end gap-3 pt-4 border-t">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => onOpenChange(false)}
                    disabled={isSaving}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isSaving}>
                    {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {isEditing ? 'Save Changes' : 'Add Asset'}
                  </Button>
                </div>
              </form>
            </Form>
          </TabsContent>

          <TabsContent value="photos" className="mt-4">
            <div className="space-y-6">
              {/* Upload Area */}
              <div
                {...getRootProps()}
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
                  isDragActive
                    ? 'border-primary bg-primary/5'
                    : 'border-muted-foreground/25 hover:border-primary/50'
                } ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <input {...getInputProps()} />
                {isUploading ? (
                  <div className="flex flex-col items-center">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    <p className="mt-2 text-sm text-muted-foreground">Uploading...</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <Upload className="h-8 w-8 text-muted-foreground" />
                    <p className="mt-2 text-sm text-muted-foreground">
                      {isDragActive
                        ? 'Drop the images here...'
                        : 'Drag & drop images, or click to select'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      JPG, PNG, GIF up to 10MB
                    </p>
                  </div>
                )}
              </div>

              {/* Photo Grid */}
              {isLoadingPhotos && isEditing ? (
                <div className="grid grid-cols-2 gap-4">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="aspect-square bg-muted animate-pulse rounded-lg" />
                  ))}
                </div>
              ) : (photos.length === 0 && pendingPhotos.length === 0) ? (
                <div className="text-center py-8 text-muted-foreground">
                  <ImageIcon className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No photos yet. Upload some images to document this asset.</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  {/* Existing photos (for editing) */}
                  {photos.map((photo) => (
                    <div
                      key={photo.id}
                      className="relative group aspect-square rounded-lg overflow-hidden bg-muted cursor-pointer"
                      onClick={() => handleViewImage(photo.signedUrl, photo.caption || photo.file_name)}
                    >
                      <img
                        src={photo.signedUrl}
                        alt={photo.caption || photo.file_name}
                        className="w-full h-full object-cover"
                      />
                      {photo.is_primary && (
                        <div className="absolute top-2 left-2">
                          <span className="bg-primary text-primary-foreground text-xs px-2 py-1 rounded flex items-center gap-1">
                            <Star className="h-3 w-3" />
                            Primary
                          </span>
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <span className="text-white text-sm font-medium">Click to view</span>
                        {!photo.is_primary && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPrimaryPhoto(photo.id);
                            }}
                            aria-label="Set as primary photo"
                          >
                            <Star className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            deletePhoto(photo.id);
                          }}
                          aria-label="Delete photo"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  {/* Pending photos (for new assets) */}
                  {pendingPhotos.map((file, index) => (
                    <div
                      key={`pending-${index}`}
                      className="relative group aspect-square rounded-lg overflow-hidden bg-muted cursor-pointer"
                      onClick={() => handleViewImage(pendingPhotoUrls[index], `Pending upload: ${file.name}`, true)}
                    >
                      <img
                        src={pendingPhotoUrls[index]}
                        alt={`Pending upload: ${file.name}`}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute top-2 left-2">
                        <span className="bg-orange-500 text-white text-xs px-2 py-1 rounded">
                          Pending
                        </span>
                      </div>
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <span className="text-white text-sm font-medium">Click to view</span>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            // Revoke the blob URL before removing the photo
                            URL.revokeObjectURL(pendingPhotoUrls[index]);
                            setPendingPhotos(prev => prev.filter((_, i) => i !== index));
                          }}
                          aria-label="Remove pending photo"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>

    {/* Image Viewer Dialog */}
    <Dialog open={imageViewerOpen} onOpenChange={handleCloseImageViewer}>
      <DialogContent
        className="max-w-[95vw] max-h-[95vh] w-full h-full p-0 bg-black/95 border-none overflow-hidden"
        aria-describedby={undefined}
      >
        <VisuallyHidden>
          <DialogTitle>View {selectedImage?.alt}</DialogTitle>
        </VisuallyHidden>

        {/* Top toolbar */}
        <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between p-4 bg-gradient-to-b from-black/80 to-transparent">
          <div className="text-white/80 text-sm truncate max-w-[60%]">
            {selectedImage?.alt}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="text-white/80 hover:text-white hover:bg-white/10"
              onClick={handleCloseImageViewer}
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Main content area */}
        <div className="flex-1 flex items-center justify-center overflow-auto p-8 pt-16">
          {selectedImage && (
            <div className="w-full h-full max-w-4xl max-h-[80vh]">
              <ImageViewer
                src={selectedImage.src}
                alt={selectedImage.alt}
                className="w-full h-full"
                showControls
                controlsPosition="overlay"
                onError={() => {
                  toast.error('The image could not be displayed.');
                }}
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
