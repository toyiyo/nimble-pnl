import React from 'react';
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
import { CreateProductData, Product } from '@/hooks/useProducts';

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
  conversion_factor: z.number().positive().optional(),
  cost_per_unit: z.number().positive().optional(),
  supplier_name: z.string().optional(),
  supplier_sku: z.string().optional(),
  par_level_min: z.number().int().min(0).optional(),
  par_level_max: z.number().int().min(0).optional(),
  current_stock: z.number().int().min(0).optional(),
  reorder_point: z.number().int().min(0).optional(),
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

const UNITS = [
  'pieces', 'lbs', 'oz', 'kg', 'g', 'mL', 'L', 'gal', 'qt', 'pt', 'cup', 'tbsp', 'tsp',
  'case', 'box', 'bag', 'bottle', 'can', 'jar', 'pack',
];

export const ProductDialog: React.FC<ProductDialogProps> = ({
  open,
  onOpenChange,
  onSubmit,
  restaurantId,
  initialData,
  editProduct,
}) => {
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
      conversion_factor: editProduct.conversion_factor || 1,
      cost_per_unit: editProduct.cost_per_unit || undefined,
      supplier_name: editProduct.supplier_name || '',
      supplier_sku: editProduct.supplier_sku || '',
      par_level_min: editProduct.par_level_min || 0,
      par_level_max: editProduct.par_level_max || 0,
      current_stock: editProduct.current_stock || 0,
      reorder_point: editProduct.reorder_point || 0,
    } : {
      sku: initialData?.sku || '',
      name: initialData?.name || '',
      package_qty: 1,
      conversion_factor: 1,
      par_level_min: 0,
      par_level_max: 0,
      current_stock: 0,
      reorder_point: 0,
    },
  });

  const handleSubmit = async (data: ProductFormData) => {
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
      conversion_factor: data.conversion_factor,
      cost_per_unit: data.cost_per_unit,
      supplier_name: data.supplier_name,
      supplier_sku: data.supplier_sku,
      par_level_min: data.par_level_min,
      par_level_max: data.par_level_max,
      current_stock: data.current_stock,
      reorder_point: data.reorder_point,
    };

    await onSubmit(productData);
    onOpenChange(false);
    form.reset();
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
                name="size_unit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Unit</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Unit" />
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
            </div>

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
                name="current_stock"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Current Stock</FormLabel>
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