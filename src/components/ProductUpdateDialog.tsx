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
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Loader2, Sparkles, CheckCircle, X, Upload } from 'lucide-react';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Product } from '@/hooks/useProducts';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { SizePackagingSection } from '@/components/SizePackagingSection';
import { RecipeConversionPreview } from '@/components/RecipeConversionPreview';
import { useProductRecipes } from '@/hooks/useProductRecipes';
import { useRestaurants } from '@/hooks/useRestaurants';
import { useProductSuppliers } from '@/hooks/useProductSuppliers';
import { useSuppliers } from '@/hooks/useSuppliers';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Star, Trash2, Plus } from 'lucide-react';

const updateSchema = z.object({
  quantity_to_add: z.coerce.number().min(0, 'Quantity must be positive').optional(),
  exact_count: z.coerce.number().min(0, 'Count must be positive').optional(),
  adjustment_mode: z.enum(['add', 'set_exact']).default('add'),
  sku: z.string().min(1, 'SKU is required'),
  name: z.string().min(1, 'Product name is required'),
  description: z.string().optional(),
  brand: z.string().optional(),
  category: z.string().optional(),
  size_value: z.coerce.number().positive().optional(),
  size_unit: z.string().optional(),
  package_qty: z.coerce.number().int().positive().optional(),
  uom_purchase: z.string().optional(),
  uom_recipe: z.string().optional(),
  
  cost_per_unit: z.coerce.number().min(0).optional(),
  supplier_name: z.string().optional(),
  supplier_sku: z.string().optional(),
  par_level_min: z.coerce.number().int().min(0).optional(),
  par_level_max: z.coerce.number().int().min(0).optional(),
  reorder_point: z.coerce.number().int().min(0).optional(),
  image_url: z.string().optional(),
});

type UpdateFormData = z.infer<typeof updateSchema>;

interface ProductUpdateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product;
  onUpdate: (updates: Partial<Product>, quantityToAdd: number) => Promise<void>;
  onEnhance?: (product: Product) => Promise<any>;
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

const UNITS = [
  'pieces', 'lbs', 'oz', 'kg', 'g', 'mL', 'L', 'gal', 'qt', 'pt', 'cup', 'tbsp', 'tsp',
  'case', 'box', 'bag', 'bottle', 'can', 'jar', 'pack',
];

export const ProductUpdateDialog: React.FC<ProductUpdateDialogProps> = ({
  open,
  onOpenChange,
  product,
  onUpdate,
  onEnhance,
}) => {
  const { toast } = useToast();
  const { restaurants } = useRestaurants();
  const currentRestaurant = restaurants[0];
  const { recipes } = useProductRecipes(product.id, currentRestaurant?.id || null);
  const { suppliers: allSuppliers } = useSuppliers();
  const { suppliers: productSuppliers, loading: suppliersLoading, setPreferredSupplier, removeSupplier, fetchSuppliers } = useProductSuppliers(product.id, currentRestaurant?.id || null);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [enhancedData, setEnhancedData] = useState<any>(null);
  const [uploading, setUploading] = useState(false);
  const [imageUrl, setImageUrl] = useState<string>('');
  const [adjustmentMode, setAdjustmentMode] = useState<'add' | 'set_exact'>('add');
  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [newSupplier, setNewSupplier] = useState({ supplier_id: '', cost: 0, supplier_sku: '' });

  const form = useForm<UpdateFormData>({
    resolver: zodResolver(updateSchema),
    defaultValues: {
      quantity_to_add: undefined,
      exact_count: product.current_stock || 0,
      adjustment_mode: 'add',
      sku: product.sku,
      name: product.name,
      description: product.description || '',
      brand: product.brand || '',
      category: product.category || '',
      size_value: product.size_value || undefined,
      size_unit: product.size_unit || product.uom_purchase || 'pieces',
      package_qty: product.package_qty || undefined,
      uom_purchase: product.uom_purchase || 'pieces',
      uom_recipe: product.uom_recipe || '',
      cost_per_unit: product.cost_per_unit || undefined,
      supplier_name: product.supplier_name || '',
      supplier_sku: product.supplier_sku || '',
      par_level_min: product.par_level_min || undefined,
      par_level_max: product.par_level_max || undefined,
      reorder_point: product.reorder_point || undefined,
      image_url: product.image_url || '',
    },
  });

  // Reset form when product changes
  useEffect(() => {
    form.reset({
      quantity_to_add: undefined,
      exact_count: product.current_stock || 0,
      adjustment_mode: 'add',
      sku: product.sku,
      name: product.name,
      description: product.description || '',
      brand: product.brand || '',
      category: product.category || '',
      size_value: product.size_value || undefined,
      size_unit: product.size_unit || product.uom_purchase || 'pieces',
      package_qty: product.package_qty || undefined,
      uom_purchase: product.uom_purchase || 'pieces',
      uom_recipe: product.uom_recipe || '',
      cost_per_unit: product.cost_per_unit || undefined,
      supplier_name: product.supplier_name || '',
      supplier_sku: product.supplier_sku || '',
      par_level_min: product.par_level_min || undefined,
      par_level_max: product.par_level_max || undefined,
      reorder_point: product.reorder_point || undefined,
      image_url: product.image_url || '',
    });
    setImageUrl(product.image_url || '');
    setEnhancedData(null); // Clear any enhanced data from previous product
  }, [product]);

  const handleEnhance = async () => {
    if (!onEnhance) return;
    
    setIsEnhancing(true);
    try {
      // Use current form data instead of saved product data
      const formData = form.getValues();
      const formBasedProduct: Product = {
        ...product,
        ...formData,
      };
      
      const enhanced = await onEnhance(formBasedProduct);
      setEnhancedData(enhanced);
      
      // Show enhanced data for user to review and apply
      if (enhanced) {
        setEnhancedData(enhanced);
        toast({
          title: "Product enhanced",
          description: "Found additional product information - review and apply changes below",
        });
      }
    } catch (error) {
      console.error('Enhancement error:', error);
      toast({
        title: "Enhancement failed",
        description: "Could not enhance product information",
        variant: "destructive",
      });
    } finally {
      setIsEnhancing(false);
    }
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random().toString(36).substring(2)}.${fileExt}`;
      const filePath = `${product.restaurant_id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('product-images')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from('product-images')
        .getPublicUrl(filePath);

      setImageUrl(data.publicUrl);
      form.setValue('image_url', data.publicUrl);
      
      toast({
        title: "Image uploaded",
        description: "Product image updated successfully",
      });
    } catch (error) {
      console.error('Error uploading image:', error);
      toast({
        title: "Upload failed",
        description: "Failed to upload image",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const applyEnhancedField = (field: string, value: any) => {
    form.setValue(field as any, value);
    setEnhancedData((prev: any) => ({
      ...prev,
      [field]: undefined // Remove applied field from suggestions
    }));
  };

  const handleSubmit = async (data: UpdateFormData) => {
    const isNewProduct = !product.id;
    const currentStock = product.current_stock || 0;
    
    let quantityToAdd = 0;
    let finalStock = currentStock;
    
    if (data.adjustment_mode === 'set_exact') {
      // For exact count adjustments (count reconciliation)
      finalStock = data.exact_count || 0;
      quantityToAdd = finalStock - currentStock; // This can be negative for decreases
    } else {
      // For additive quantities (purchases)
      quantityToAdd = data.quantity_to_add || 0;
      finalStock = isNewProduct ? quantityToAdd : currentStock + quantityToAdd;
    }
    
    const updates: Partial<Product> = {
      sku: data.sku,
      name: data.name,
      description: data.description,
      brand: data.brand,
      category: data.category,
      size_value: data.size_value,
      size_unit: data.size_unit,
      package_qty: data.package_qty || 1,
      uom_purchase: data.uom_purchase,
      uom_recipe: data.uom_recipe,
      cost_per_unit: data.cost_per_unit,
      supplier_name: data.supplier_name,
      supplier_sku: data.supplier_sku,
      par_level_min: data.par_level_min || 0,
      par_level_max: data.par_level_max || 0,
      reorder_point: data.reorder_point || 0,
      image_url: imageUrl || data.image_url,
      current_stock: finalStock,
    };

    await onUpdate(updates, quantityToAdd);
    onOpenChange(false);
  };

  const currentStock = product.current_stock || 0;
  const newQuantity = form.watch('quantity_to_add') || 0;
  const exactCount = form.watch('exact_count') || 0;
  const mode = form.watch('adjustment_mode') || 'add';
  const totalAfterUpdate = mode === 'set_exact' ? exactCount : currentStock + newQuantity;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex flex-col sm:flex-row sm:items-start gap-4">
            <div className="flex-1">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="flex-1">
                  <DialogTitle className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <span>Update Product: {product.name}</span>
                    <Badge variant="secondary" className="w-fit">
                      Current Stock: {currentStock} {product.uom_purchase || 'units'}
                    </Badge>
                  </DialogTitle>
                  <DialogDescription className="mt-1">
                    Add inventory quantity and update product information
                  </DialogDescription>
                </div>
                {onEnhance && (
                  <Button 
                    onClick={handleEnhance}
                    disabled={isEnhancing}
                    variant="outline"
                    size="sm"
                    className="flex items-center gap-2 w-fit"
                  >
                    {isEnhancing ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Enhancing...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" />
                        AI Enhance
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
            {product.image_url || imageUrl ? (
              <div className="flex-shrink-0">
                <img 
                  src={imageUrl || product.image_url} 
                  alt={product.name}
                  className="w-24 h-24 object-cover rounded-lg border border-border"
                />
              </div>
            ) : null}
          </div>
        </DialogHeader>

        {/* AI Enhancement Suggestions */}
        {enhancedData && Object.keys(enhancedData).some(key => enhancedData[key] && key !== 'nutritionalInfo' && key !== 'ingredients' && key !== 'packageSize' && key !== 'manufacturer') && (
          <Card className="bg-gradient-to-r from-blue-50 to-purple-50 border-blue-200">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-blue-900">
                <Sparkles className="h-5 w-5" />
                AI Enhancement Suggestions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {enhancedData.description && (
                <div className="flex flex-col sm:flex-row gap-2 p-3 bg-white rounded-lg border">
                  <div className="flex-1">
                    <div className="font-medium text-sm text-gray-700">Description</div>
                    <div className="text-sm mt-1 text-gray-600">{enhancedData.description}</div>
                  </div>
                  <Button
                    onClick={() => applyEnhancedField('description', enhancedData.description)}
                    size="sm"
                    variant="outline"
                    className="w-fit"
                  >
                    <CheckCircle className="h-4 w-4 mr-1" />
                    Apply
                  </Button>
                </div>
              )}
              {enhancedData.brand && (
                <div className="flex flex-col sm:flex-row gap-2 p-3 bg-white rounded-lg border">
                  <div className="flex-1">
                    <div className="font-medium text-sm text-gray-700">Brand</div>
                    <div className="text-sm mt-1 text-gray-600">{enhancedData.brand}</div>
                  </div>
                  <Button
                    onClick={() => applyEnhancedField('brand', enhancedData.brand)}
                    size="sm"
                    variant="outline"
                    className="w-fit"
                  >
                    <CheckCircle className="h-4 w-4 mr-1" />
                    Apply
                  </Button>
                </div>
              )}
              {enhancedData.category && (
                <div className="flex flex-col sm:flex-row gap-2 p-3 bg-white rounded-lg border">
                  <div className="flex-1">
                    <div className="font-medium text-sm text-gray-700">Category</div>
                    <div className="text-sm mt-1 text-gray-600">{enhancedData.category}</div>
                  </div>
                  <Button
                    onClick={() => applyEnhancedField('category', enhancedData.category)}
                    size="sm"
                    variant="outline"
                    className="w-fit"
                  >
                    <CheckCircle className="h-4 w-4 mr-1" />
                    Apply
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
            {/* Quantity Section */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Inventory Update</CardTitle>
                <div className="flex gap-2 mt-2">
                  <Button
                    type="button"
                    variant={adjustmentMode === 'add' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      setAdjustmentMode('add');
                      form.setValue('adjustment_mode', 'add');
                    }}
                  >
                    Add Quantity
                  </Button>
                  <Button
                    type="button"
                    variant={adjustmentMode === 'set_exact' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      setAdjustmentMode('set_exact');
                      form.setValue('adjustment_mode', 'set_exact');
                    }}
                  >
                    Set Exact Count
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {adjustmentMode === 'add' ? (
                    <div className="space-y-4">
                      <FormField
                        control={form.control}
                        name="quantity_to_add"
                        render={({ field }) => {
                          const purchaseUnit = form.watch('uom_purchase') || 'pieces';
                          
                          return (
                            <FormItem>
                              <FormLabel>
                                Quantity to Add (in {purchaseUnit})
                              </FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.1"
                                  placeholder="Enter quantity"
                                  value={field.value ?? ''}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    field.onChange(value === '' ? undefined : Number(value));
                                  }}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          );
                        }}
                      />
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <FormField
                        control={form.control}
                        name="exact_count"
                        render={({ field }) => {
                          const purchaseUnit = form.watch('uom_purchase') || 'pieces';
                          
                          return (
                            <FormItem>
                              <FormLabel>Exact Stock Count (in {purchaseUnit})</FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.1"
                                  placeholder="Enter exact count"
                                  value={field.value ?? ''}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    field.onChange(value === '' ? undefined : Number(value));
                                  }}
                                />
                              </FormControl>
                              <FormMessage />
                              <p className="text-xs text-muted-foreground">
                                This will trigger an "adjustment" transaction for count reconciliation
                              </p>
                            </FormItem>
                          );
                        }}
                      />
                    </div>
                  )}

                  <FormField
                    control={form.control}
                    name="size_unit"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Unit</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select unit" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {UNITS.map((unit) => (
                              <SelectItem key={unit} value={unit}>
                                {unit}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {(newQuantity > 0 || adjustmentMode === 'set_exact') && (
                  <div className="p-3 bg-muted rounded-md">
                    <p className="text-sm">
                      <strong>Stock Update Preview:</strong><br />
                      {(() => {
                        const displayUnit = form.getValues('uom_purchase') || 'units';
                        
                        const formatValue = (value: number) => {
                          return value % 1 === 0 ? value.toString() : value.toFixed(2);
                        };
                        
                        if (product.id) {
                          if (adjustmentMode === 'set_exact') {
                            const adjustment = exactCount - currentStock;
                            return `Current: ${formatValue(currentStock)} → Set to: ${formatValue(exactCount)} ${displayUnit} (${adjustment >= 0 ? '+' : ''}${formatValue(adjustment)} adjustment)`;
                          } else {
                            return `Current: ${formatValue(currentStock)} → New Total: ${formatValue(totalAfterUpdate)} ${displayUnit}`;
                          }
                        } else {
                          const initialValue = adjustmentMode === 'set_exact' ? exactCount : newQuantity;
                          return `Initial Stock: ${formatValue(initialValue)} ${displayUnit}`;
                        }
                      })()}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Basic Information */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Basic Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="sku"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>SKU *</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="e.g., BEEF-001" />
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
                          <Input {...field} placeholder="e.g., Ground Beef 80/20" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea {...field} rows={3} placeholder="Additional product details..." />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Image Upload Section */}
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
                        id="image-upload-update"
                      />
                      <Label
                        htmlFor="image-upload-update"
                        className="flex items-center justify-center w-32 h-32 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-gray-400 transition-colors"
                      >
                        {imageUrl || product.image_url ? (
                          <img
                            src={imageUrl || product.image_url}
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
                    {(imageUrl || product.image_url) && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setImageUrl('');
                          form.setValue('image_url', '');
                        }}
                        className="h-8"
                      >
                        <X className="h-4 w-4 mr-1" />
                        Remove
                      </Button>
                    )}
                  </div>
                </div>

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
                        <FormControl>
                          <Input
                            list="categories-list"
                            placeholder="Enter or select category"
                            {...field}
                          />
                        </FormControl>
                        <datalist id="categories-list">
                          {CATEGORIES.map((category) => (
                            <option key={category} value={category} />
                          ))}
                        </datalist>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Enhanced Size & Packaging Section */}
            <SizePackagingSection form={form} />

            {/* Recipe Conversion Preview */}
            {recipes.length > 0 && form.watch('name') && form.watch('size_value') && form.watch('uom_purchase') && (
              <>
                {recipes.map((recipeIngredient) => (
                  <RecipeConversionPreview
                    key={recipeIngredient.id}
                    productName={form.watch('name')}
                    purchaseQuantity={form.watch('size_value') * (form.watch('package_qty') || 1)}
                    purchaseUnit={form.watch('uom_purchase')}
                    recipeQuantity={recipeIngredient.quantity}
                    recipeUnit={recipeIngredient.unit}
                    costPerUnit={form.watch('cost_per_unit')}
                    recipeName={recipeIngredient.recipe.name}
                  />
                ))}
              </>
            )}

            {/* Cost & Supplier */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Cost & Supplier</CardTitle>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAddSupplier(!showAddSupplier)}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add Supplier
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {showAddSupplier && (
                  <Card className="bg-muted/50">
                    <CardContent className="pt-4 space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <Label>Supplier</Label>
                          <Select
                            value={newSupplier.supplier_id}
                            onValueChange={(value) => setNewSupplier({ ...newSupplier, supplier_id: value })}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select supplier" />
                            </SelectTrigger>
                            <SelectContent>
                              {allSuppliers.map((supplier) => (
                                <SelectItem key={supplier.id} value={supplier.id}>
                                  {supplier.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Cost per Unit ($)</Label>
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                            value={newSupplier.cost || ''}
                            onChange={(e) => setNewSupplier({ ...newSupplier, cost: Number(e.target.value) })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Supplier SKU</Label>
                          <Input
                            placeholder="Supplier's code"
                            value={newSupplier.supplier_sku}
                            onChange={(e) => setNewSupplier({ ...newSupplier, supplier_sku: e.target.value })}
                          />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={async () => {
                            if (!newSupplier.supplier_id || !currentRestaurant?.id) return;
                            
                            try {
                              const { error } = await supabase
                                .from('product_suppliers')
                                .insert({
                                  restaurant_id: currentRestaurant.id,
                                  product_id: product.id,
                                  supplier_id: newSupplier.supplier_id,
                                  last_unit_cost: newSupplier.cost,
                                  supplier_sku: newSupplier.supplier_sku,
                                  is_preferred: productSuppliers.length === 0,
                                });

                              if (error) throw error;

                              toast({
                                title: 'Supplier added',
                                description: 'Successfully added supplier to product',
                              });

                              setNewSupplier({ supplier_id: '', cost: 0, supplier_sku: '' });
                              setShowAddSupplier(false);
                              fetchSuppliers();
                            } catch (error) {
                              console.error('Error adding supplier:', error);
                              toast({
                                title: 'Error',
                                description: 'Failed to add supplier',
                                variant: 'destructive',
                              });
                            }
                          }}
                        >
                          Save Supplier
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setShowAddSupplier(false);
                            setNewSupplier({ supplier_id: '', cost: 0, supplier_sku: '' });
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {productSuppliers.length > 0 ? (
                  <div className="border rounded-lg">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Supplier</TableHead>
                          <TableHead className="text-right">Last Price</TableHead>
                          <TableHead className="text-right">Avg Price</TableHead>
                          <TableHead className="text-center">Purchases</TableHead>
                          <TableHead>Last Order</TableHead>
                          <TableHead className="text-center">Preferred</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {productSuppliers.map((ps) => (
                          <TableRow key={ps.id}>
                            <TableCell className="font-medium">
                              {ps.supplier_name}
                              {ps.supplier_sku && (
                                <div className="text-xs text-muted-foreground">SKU: {ps.supplier_sku}</div>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {ps.last_unit_cost ? `$${ps.last_unit_cost.toFixed(2)}` : '-'}
                            </TableCell>
                            <TableCell className="text-right">
                              {ps.average_unit_cost ? `$${ps.average_unit_cost.toFixed(2)}` : '-'}
                            </TableCell>
                            <TableCell className="text-center">
                              {ps.purchase_count || 0}
                            </TableCell>
                            <TableCell>
                              {ps.last_purchase_date
                                ? new Date(ps.last_purchase_date).toLocaleDateString()
                                : '-'}
                            </TableCell>
                            <TableCell className="text-center">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setPreferredSupplier(ps.id)}
                                disabled={ps.is_preferred}
                              >
                                <Star
                                  className={`h-4 w-4 ${
                                    ps.is_preferred ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground'
                                  }`}
                                />
                              </Button>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  if (confirm('Remove this supplier from this product?')) {
                                    removeSupplier(ps.id);
                                  }
                                }}
                                disabled={productSuppliers.length === 1}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    No suppliers added yet. Click "Add Supplier" to get started.
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Inventory Levels */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Inventory Levels</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormField
                    control={form.control}
                    name="par_level_min"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Min Par Level</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="number"
                            min="0"
                            placeholder="0"
                            value={field.value ?? ''}
                            onChange={(e) => {
                              const value = e.target.value;
                              field.onChange(value === '' ? undefined : Number(value));
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="par_level_max"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Max Par Level</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="number"
                            min="0"
                            placeholder="0"
                            value={field.value ?? ''}
                            onChange={(e) => {
                              const value = e.target.value;
                              field.onChange(value === '' ? undefined : Number(value));
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="reorder_point"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Reorder Point</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="number"
                            min="0"
                            placeholder="0"
                            value={field.value ?? ''}
                            onChange={(e) => {
                              const value = e.target.value;
                              field.onChange(value === '' ? undefined : Number(value));
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>

            <div className="flex flex-col sm:flex-row justify-end gap-2">
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => onOpenChange(false)}
                className="w-full sm:w-auto"
              >
                Cancel
              </Button>
              <Button type="submit" className="w-full sm:w-auto">
                Update Product
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};