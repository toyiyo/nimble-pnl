import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
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
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Upload, Calculator, Package } from 'lucide-react';
import { InventoryLevelInput } from '@/components/InventoryLevelInput';
import { CreateProductData, Product } from '@/hooks/useProducts';
import { useUnitConversion } from '@/hooks/useUnitConversion';
import { normalizeUnitName, suggestRecipeUnits } from '@/lib/unitConversion';
import { SearchableSupplierSelector } from '@/components/SearchableSupplierSelector';
import { useSuppliers } from '@/hooks/useSuppliers';
import { supabase } from '@/integrations/supabase/client';
import { SizePackagingSection } from '@/components/SizePackagingSection';
import { useRestaurants } from '@/hooks/useRestaurants';

const productSchema = z.object({
  sku: z.string().min(1, 'SKU is required'),
  name: z.string().min(1, 'Product name is required'),
  description: z.string().optional(),
  brand: z.string().optional(),
  category: z.string().optional(),
  size_value: z.number().positive().optional(),
  size_unit: z.string().optional(),
  package_qty: z.number().int().positive().optional(),
  uom_purchase: z.string().optional(),
  uom_recipe: z.string().optional(),
  
  cost_per_unit: z.number().min(0).optional(),
  supplier_name: z.string().optional(),
  supplier_sku: z.string().optional(),
  par_level_min: z.number().min(0).optional(),
  par_level_max: z.number().min(0).optional(),
  current_stock: z.number().min(0).optional(),
  reorder_point: z.number().min(0).optional(),
  pos_item_name: z.string().optional(),
  image_url: z.string().optional(),
});

type ProductFormData = z.infer<typeof productSchema>;

interface ProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CreateProductData) => Promise<void>;
  restaurantId: string;
  initialData?: {
    gtin?: string;
    sku?: string;
    name?: string;
  };
  editProduct?: Product;
}

const CATEGORIES = [
  'Beverages',
  'Meat & Poultry',
  'Seafood',
  'Produce',
  'Dairy',
  'Dry Goods',
  'Spices & Seasonings',
  'Cleaning Supplies',
  'Paper Products',
  'Other',
];

const PURCHASE_UNITS = [
  'pieces', 'lbs', 'oz', 'kg', 'g', 'mL', 'L', 'gal', 'qt', 'pt', 'cup', 'tbsp', 'tsp',
  'case', 'box', 'bag', 'bottle', 'can', 'jar', 'pack',
];

const RECIPE_UNITS = [
  'fl oz', 'oz' 'ml', 'cup', 'tbsp', 'tsp', 'lb', 'g', 'each', 'piece', 'serving'
];

export const ProductDialog: React.FC<ProductDialogProps> = ({
  open,
  onOpenChange,
  onSubmit,
  restaurantId,
  initialData,
  editProduct,
}) => {
  const [uploading, setUploading] = useState(false);
  const [imageUrl, setImageUrl] = useState<string>('');
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | undefined>();
  const [isNewSupplier, setIsNewSupplier] = useState(false);
  const { suppliers, createSupplier } = useSuppliers();
  const [suggestedConversionFactor, setSuggestedConversionFactor] = useState<number | null>(null);
  const { suggestConversionFactor } = useUnitConversion(restaurantId);

  const form = useForm<ProductFormData>({
    resolver: zodResolver(productSchema),
    defaultValues: editProduct ? {
      sku: editProduct.sku,
      name: editProduct.name,
      description: editProduct.description || '',
      brand: editProduct.brand || '',
      category: editProduct.category || '',
      size_value: editProduct.size_value || undefined,
      size_unit: editProduct.size_unit || '',
      package_qty: editProduct.package_qty || 1,
      uom_purchase: editProduct.uom_purchase || '',
      uom_recipe: editProduct.uom_recipe || '',
      
      cost_per_unit: editProduct.cost_per_unit || undefined,
      supplier_name: editProduct.supplier_name || '',
      supplier_sku: editProduct.supplier_sku || '',
      par_level_min: editProduct.par_level_min || 0,
      par_level_max: editProduct.par_level_max || 0,
      current_stock: editProduct.current_stock || 0,
      reorder_point: editProduct.reorder_point || 0,
      pos_item_name: editProduct.pos_item_name || '',
      image_url: editProduct.image_url || '',
    } : {
      sku: initialData?.sku || '',
      name: initialData?.name || '',
      package_qty: 1,  // Default to buying 1 package
      
      par_level_min: 0,
      par_level_max: 0,
      current_stock: 0,
      reorder_point: 0,
      pos_item_name: '',
      image_url: '',
    },
  });

  React.useEffect(() => {
    if (editProduct?.image_url) {
      setImageUrl(editProduct.image_url);
    }
  }, [editProduct]);

  // Reset form when initialData or editProduct changes
  React.useEffect(() => {
    form.reset(editProduct ? {
      sku: editProduct.sku,
      name: editProduct.name,
      description: editProduct.description || '',
      brand: editProduct.brand || '',
      category: editProduct.category || '',
      size_value: editProduct.size_value || undefined,
      size_unit: editProduct.size_unit || '',
      package_qty: editProduct.package_qty || 1,
      uom_purchase: editProduct.uom_purchase || '',
      uom_recipe: editProduct.uom_recipe || '',
      cost_per_unit: editProduct.cost_per_unit || undefined,
      supplier_name: editProduct.supplier_name || '',
      supplier_sku: editProduct.supplier_sku || '',
      par_level_min: editProduct.par_level_min || 0,
      par_level_max: editProduct.par_level_max || 0,
      current_stock: editProduct.current_stock || 0,
      reorder_point: editProduct.reorder_point || 0,
      pos_item_name: editProduct.pos_item_name || '',
      image_url: editProduct.image_url || '',
    } : {
      sku: initialData?.sku || '',
      name: initialData?.name || '',
      package_qty: 1,
      par_level_min: 0,
      par_level_max: 0,
      current_stock: 0,
      reorder_point: 0,
      pos_item_name: '',
      image_url: '',
    });
  }, [editProduct, initialData]);

  // Watch for unit changes and suggest conversion factor
  const watchedPurchaseUnit = form.watch('uom_purchase');
  const watchedRecipeUnit = form.watch('uom_recipe');

  useEffect(() => {
    if (watchedPurchaseUnit && watchedRecipeUnit) {
      const normalizedPurchase = normalizeUnitName(watchedPurchaseUnit);
      const normalizedRecipe = normalizeUnitName(watchedRecipeUnit);
      const suggested = suggestConversionFactor(normalizedPurchase, normalizedRecipe);
      
      if (suggested !== 1) {
        setSuggestedConversionFactor(suggested);
      } else {
        setSuggestedConversionFactor(null);
      }
    } else {
      setSuggestedConversionFactor(null);
    }
  }, [watchedPurchaseUnit, watchedRecipeUnit, suggestConversionFactor]);

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random().toString(36).substring(2)}.${fileExt}`;
      const filePath = `${restaurantId}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('product-images')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from('product-images')
        .getPublicUrl(filePath);

      setImageUrl(data.publicUrl);
      form.setValue('image_url', data.publicUrl);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Error uploading image:', error);
      }
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (data: ProductFormData) => {
    // Handle new supplier creation if needed
    let supplierIdToUse = selectedSupplierId;
    if (isNewSupplier && data.supplier_name) {
      const newSupplier = await createSupplier({ name: data.supplier_name });
      if (newSupplier) {
        supplierIdToUse = newSupplier.id;
      }
    }

    const productData: CreateProductData = {
      restaurant_id: restaurantId,
      gtin: initialData?.gtin,
      sku: data.sku,
      name: data.name,
      description: data.description,
      brand: data.brand,
      category: data.category,
      size_value: data.size_value,
      size_unit: data.size_unit,
      package_qty: data.package_qty,
      uom_purchase: data.uom_purchase,
      uom_recipe: data.uom_recipe,
      cost_per_unit: data.cost_per_unit,
      supplier_name: data.supplier_name,
      supplier_sku: data.supplier_sku,
      supplier_id: supplierIdToUse,
      par_level_min: data.par_level_min,
      par_level_max: data.par_level_max,
      current_stock: data.current_stock,
      reorder_point: data.reorder_point,
      pos_item_name: data.pos_item_name,
      image_url: imageUrl || data.image_url,
    };

    await onSubmit(productData);
    onOpenChange(false);
    form.reset();
    setImageUrl('');
    setSelectedSupplierId(undefined);
    setIsNewSupplier(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editProduct ? 'Edit Product' : 'Add New Product'}
          </DialogTitle>
          <DialogDescription>
            {editProduct 
              ? 'Update the product information below.'
              : 'Enter the product details. Items marked with * are required.'
            }
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="sku"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>SKU *</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g., BEEF-001" value={field.value || ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Product Name *</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g., Ground Beef 80/20" value={field.value || ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="pos_item_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>POS Item Name</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Name used in POS system (if different)" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-2">
              <Label>Product Image</Label>
              <div className="flex items-center space-x-4">
                <div className="relative">
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    disabled={uploading}
                    className="hidden"
                    id="image-upload"
                  />
                  <Label
                    htmlFor="image-upload"
                    className="flex items-center justify-center w-32 h-32 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-gray-400 transition-colors"
                  >
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt="Product preview"
                        className="w-full h-full object-cover rounded-lg"
                      />
                    ) : (
                      <div className="text-center">
                        <Upload className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                        <span className="text-sm text-gray-500">
                          {uploading ? 'Uploading...' : 'Upload Image'}
                        </span>
                      </div>
                    )}
                  </Label>
                </div>
              </div>
            </div>

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea 
                      {...field} 
                      placeholder="Additional product details..."
                      rows={2}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="brand"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Brand</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g., Local Farm Co." />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || ''}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {CATEGORIES.map((category) => (
                          <SelectItem key={category} value={category}>
                            {category}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Enhanced Size and Packaging Section with Unit Conversion */}
            <SizePackagingSection form={form} />

            {/* Recipe Unit Conversion */}
            <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
              <h4 className="font-medium text-sm flex items-center gap-2">
                <Calculator className="h-4 w-4" />
                Recipe Unit Conversion
              </h4>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="uom_recipe"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Recipe Unit</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || ''}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select unit" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {RECIPE_UNITS.map(unit => (
                            <SelectItem key={unit} value={unit}>{unit}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

              </div>
            </div>

            {/* Cost & Supplier Section */}
            <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
              <h4 className="font-medium text-sm flex items-center gap-2">
                <Package className="h-4 w-4" />
                Cost & Supplier
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="cost_per_unit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Cost per {form.watch('uom_purchase') || 'Purchase Unit'} ($)
                      </FormLabel>
                      <FormControl>
                       <Input
                          {...field}
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          value={field.value || ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            field.onChange(value ? parseFloat(value) : undefined);
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormItem>
                  <FormLabel>Supplier</FormLabel>
                  <SearchableSupplierSelector
                    value={selectedSupplierId}
                    onValueChange={(value, isNew) => {
                      setSelectedSupplierId(value);
                      setIsNewSupplier(isNew);
                      if (!isNew) {
                        const supplier = suppliers.find(s => s.id === value);
                        form.setValue('supplier_name', supplier?.name || '');
                      } else {
                        form.setValue('supplier_name', value);
                      }
                    }}
                    suppliers={suppliers}
                    placeholder="Search or create supplier..."
                    showNewIndicator={isNewSupplier}
                  />
                </FormItem>

                <FormField
                  control={form.control}
                  name="supplier_sku"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Supplier SKU</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Supplier's product code" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Inventory Levels Section */}
            <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
              <h4 className="font-medium text-sm flex items-center gap-2">
                <Package className="h-4 w-4" />
                Inventory Levels
              </h4>

              {/* Info box explaining units */}
              {form.watch('size_value') && form.watch('size_unit') && (
                <div className="p-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-md">
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    💡 <strong>Inventory levels are measured in your package size units</strong>
                  </p>
                  <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                    Since you purchase this as "{form.watch('uom_purchase')}" containing {form.watch('size_value')} {form.watch('size_unit')}, 
                    enter your desired levels in {form.watch('size_unit')} (e.g., gallons, ounces).
                  </p>
                </div>
              )}

              <FormField
                control={form.control}
                name="current_stock"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Current Stock</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0"
                        onChange={(e) => field.onChange(Number(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <InventoryLevelInput
                label="Reorder Point"
                value={form.watch('reorder_point') || 0}
                onChange={(val) => form.setValue('reorder_point', val)}
                product={{
                  uom_purchase: form.watch('uom_purchase'),
                  size_value: form.watch('size_value'),
                  size_unit: form.watch('size_unit'),
                  name: form.watch('name')
                }}
                helpText="When stock falls to this level, you'll get an alert to reorder"
              />
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <InventoryLevelInput
                  label="Minimum Par Level"
                  value={form.watch('par_level_min') || 0}
                  onChange={(val) => form.setValue('par_level_min', val)}
                  product={{
                    uom_purchase: form.watch('uom_purchase'),
                    size_value: form.watch('size_value'),
                    size_unit: form.watch('size_unit'),
                    name: form.watch('name')
                  }}
                  helpText="Minimum stock you want to maintain"
                />
                
                <InventoryLevelInput
                  label="Maximum Par Level"
                  value={form.watch('par_level_max') || 0}
                  onChange={(val) => form.setValue('par_level_max', val)}
                  product={{
                    uom_purchase: form.watch('uom_purchase'),
                    size_value: form.watch('size_value'),
                    size_unit: form.watch('size_unit'),
                    name: form.watch('name')
                  }}
                  helpText="Maximum stock level (useful for space management)"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit">
                {editProduct ? 'Update Product' : 'Add Product'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};