import { useState, useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
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
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, ChevronDown, Upload, X, Star, Trash2, ImageIcon } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { useQuery } from '@tanstack/react-query';
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

export function AssetDialog({
  open,
  onOpenChange,
  asset,
  onSave,
  isSaving,
}: AssetDialogProps) {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id;
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activeTab, setActiveTab] = useState('details');

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
      const { data, error } = await supabase
        .from('chart_of_accounts')
        .select('id, account_code, account_name, account_type, account_subtype')
        .eq('restaurant_id', restaurantId)
        .in('account_subtype', ['fixed_assets', 'accumulated_depreciation', 'depreciation'])
        .order('account_code');
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

  // Photo upload dropzone
  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (!asset?.id) return;
      for (const file of acceptedFiles) {
        await uploadPhoto(file);
      }
    },
    [asset?.id, uploadPhoto]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
    },
    disabled: !asset?.id || isUploading,
  });

  const handleSubmit = async (data: AssetFormData) => {
    await onSave(data);
  };

  const isEditing = !!asset;
  const purchaseCost = form.watch('purchase_cost');
  const salvageValue = form.watch('salvage_value');
  const usefulLifeMonths = form.watch('useful_life_months');

  // Calculate preview depreciation
  const depreciableAmount = purchaseCost - salvageValue;
  const monthlyDepreciation = usefulLifeMonths > 0 ? depreciableAmount / usefulLifeMonths : 0;

  return (
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
            <TabsTrigger value="photos" disabled={!isEditing}>
              Photos {photos.length > 0 && `(${photos.length})`}
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
                        <Select onValueChange={field.onChange} value={field.value || ''}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select location (optional)" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="">No location</SelectItem>
                            {locations.map((loc) => (
                              <SelectItem key={loc.id} value={loc.id}>
                                {loc.name}
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
                          <Select onValueChange={field.onChange} value={field.value || ''}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select asset account" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="">None</SelectItem>
                              {accounts
                                .filter((a) => a.account_subtype === 'fixed_assets')
                                .map((acc) => (
                                  <SelectItem key={acc.id} value={acc.id}>
                                    {acc.account_code} - {acc.account_name}
                                  </SelectItem>
                                ))}
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
                          <Select onValueChange={field.onChange} value={field.value || ''}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select account" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="">None</SelectItem>
                              {accounts
                                .filter((a) => a.account_subtype === 'accumulated_depreciation')
                                .map((acc) => (
                                  <SelectItem key={acc.id} value={acc.id}>
                                    {acc.account_code} - {acc.account_name}
                                  </SelectItem>
                                ))}
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
                          <Select onValueChange={field.onChange} value={field.value || ''}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select expense account" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="">None</SelectItem>
                              {accounts
                                .filter((a) => a.account_subtype === 'depreciation')
                                .map((acc) => (
                                  <SelectItem key={acc.id} value={acc.id}>
                                    {acc.account_code} - {acc.account_name}
                                  </SelectItem>
                                ))}
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
            {isEditing && (
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
                {isLoadingPhotos ? (
                  <div className="grid grid-cols-2 gap-4">
                    {[...Array(4)].map((_, i) => (
                      <div key={i} className="aspect-square bg-muted animate-pulse rounded-lg" />
                    ))}
                  </div>
                ) : photos.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <ImageIcon className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>No photos yet. Upload some images to document this asset.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    {photos.map((photo) => (
                      <div
                        key={photo.id}
                        className="relative group aspect-square rounded-lg overflow-hidden bg-muted"
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
                          {!photo.is_primary && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setPrimaryPhoto(photo.id)}
                              aria-label="Set as primary photo"
                            >
                              <Star className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => deletePhoto(photo.id)}
                            aria-label="Delete photo"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
