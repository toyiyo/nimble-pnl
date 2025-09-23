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
import { Loader2, Sparkles, CheckCircle, X } from 'lucide-react';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Product } from '@/hooks/useProducts';
import { useToast } from '@/hooks/use-toast';

const updateSchema = z.object({
  quantity_to_add: z.number().min(0, 'Quantity must be positive'),
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
  conversion_factor: z.number().positive().optional(),
  cost_per_unit: z.number().positive().optional(),
  supplier_name: z.string().optional(),
  supplier_sku: z.string().optional(),
  par_level_min: z.number().int().min(0).optional(),
  par_level_max: z.number().int().min(0).optional(),
  reorder_point: z.number().int().min(0).optional(),
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
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [enhancedData, setEnhancedData] = useState<any>(null);

  const form = useForm<UpdateFormData>({
    resolver: zodResolver(updateSchema),
    defaultValues: {
      quantity_to_add: 0,
      sku: product.sku,
      name: product.name,
      description: product.description || '',
      brand: product.brand || '',
      category: product.category || '',
      size_value: product.size_value || undefined,
      size_unit: product.size_unit || 'pieces',
      package_qty: product.package_qty || 1,
      uom_purchase: product.uom_purchase || '',
      uom_recipe: product.uom_recipe || '',
      conversion_factor: product.conversion_factor || 1,
      cost_per_unit: product.cost_per_unit || undefined,
      supplier_name: product.supplier_name || '',
      supplier_sku: product.supplier_sku || '',
      par_level_min: product.par_level_min || 0,
      par_level_max: product.par_level_max || 0,
      reorder_point: product.reorder_point || 0,
    },
  });

  // Reset form when product changes
  useEffect(() => {
    form.reset({
      quantity_to_add: 0,
      sku: product.sku,
      name: product.name,
      description: product.description || '',
      brand: product.brand || '',
      category: product.category || '',
      size_value: product.size_value || undefined,
      size_unit: product.size_unit || 'pieces',
      package_qty: product.package_qty || 1,
      uom_purchase: product.uom_purchase || '',
      uom_recipe: product.uom_recipe || '',
      conversion_factor: product.conversion_factor || 1,
      cost_per_unit: product.cost_per_unit || undefined,
      supplier_name: product.supplier_name || '',
      supplier_sku: product.supplier_sku || '',
      par_level_min: product.par_level_min || 0,
      par_level_max: product.par_level_max || 0,
      reorder_point: product.reorder_point || 0,
    });
    setEnhancedData(null); // Clear any enhanced data from previous product
  }, [product, form]);

  const handleEnhance = async () => {
    if (!onEnhance) return;
    
    setIsEnhancing(true);
    try {
      const enhanced = await onEnhance(product);
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

  const applyEnhancedField = (field: string, value: any) => {
    form.setValue(field as any, value);
    setEnhancedData((prev: any) => ({
      ...prev,
      [field]: undefined // Remove applied field from suggestions
    }));
  };

  const handleSubmit = async (data: UpdateFormData) => {
    const updates: Partial<Product> = {
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
      conversion_factor: data.conversion_factor,
      cost_per_unit: data.cost_per_unit,
      supplier_name: data.supplier_name,
      supplier_sku: data.supplier_sku,
      par_level_min: data.par_level_min,
      par_level_max: data.par_level_max,
      reorder_point: data.reorder_point,
      current_stock: (product.current_stock || 0) + data.quantity_to_add,
    };

    await onUpdate(updates, data.quantity_to_add);
    onOpenChange(false);
  };

  const currentStock = product.current_stock || 0;
  const newQuantity = form.watch('quantity_to_add') || 0;
  const totalAfterUpdate = currentStock + newQuantity;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <div className="flex-1">
              <DialogTitle className="flex flex-col sm:flex-row sm:items-center gap-2">
                <span>Update Product: {product.name}</span>
                <Badge variant="secondary" className="w-fit">Current Stock: {currentStock}</Badge>
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
                <CardTitle className="text-lg">Add to Inventory</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="quantity_to_add"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Quantity to Add</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="number"
                            min="0"
                            step="0.1"
                            placeholder="Enter quantity"
                            onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : 0)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

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

                {newQuantity > 0 && (
                  <div className="p-3 bg-muted rounded-md">
                    <p className="text-sm">
                      <strong>Stock Update Preview:</strong><br />
                      Current: {currentStock} → New Total: {totalAfterUpdate} {form.getValues('size_unit')}
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
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
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
              </CardContent>
            </Card>

            {/* Size & Packaging */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Size & Packaging</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormField
                    control={form.control}
                    name="size_value"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Size/Weight</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="number"
                            step="0.01"
                            placeholder="e.g., 5"
                            onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : undefined)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="package_qty"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Package Qty</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="number"
                            min="1"
                            placeholder="1"
                            onChange={(e) => field.onChange(Number(e.target.value))}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="conversion_factor"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Conversion Factor</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="number"
                            step="0.01"
                            placeholder="1"
                            onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : 1)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="uom_purchase"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Purchase UOM</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="e.g., case" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="uom_recipe"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Recipe UOM</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="e.g., oz" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Cost & Supplier */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Cost & Supplier</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="cost_per_unit"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Cost per Unit ($)</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                            onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : undefined)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="supplier_name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Supplier</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Supplier name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

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
                            onChange={(e) => field.onChange(Number(e.target.value))}
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
                            onChange={(e) => field.onChange(Number(e.target.value))}
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
                            onChange={(e) => field.onChange(Number(e.target.value))}
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