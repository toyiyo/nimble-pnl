import React, { useState } from 'react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Search, Sparkles } from 'lucide-react';
import { Product } from '@/hooks/useProducts';
import { useToast } from '@/hooks/use-toast';

const updateSchema = z.object({
  quantity_to_add: z.number().min(0, 'Quantity must be positive'),
  unit: z.string().optional(),
  cost_per_unit: z.number().positive().optional(),
  supplier_name: z.string().optional(),
  name: z.string().min(1, 'Product name is required'),
  description: z.string().optional(),
  brand: z.string().optional(),
  category: z.string().optional(),
});

type UpdateFormData = z.infer<typeof updateSchema>;

interface ProductUpdateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product;
  onUpdate: (updates: Partial<Product>, quantityToAdd: number) => Promise<void>;
  onEnhance?: (product: Product) => Promise<any>;
}

const UNITS = [
  'pieces', 'items', 'bottles', 'cans', 'boxes', 'cases', 'packages',
  'lbs', 'pounds', 'oz', 'ounces', 'kg', 'grams',
  'gallons', 'liters', 'ml', 'quarts', 'pints',
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
      unit: product.size_unit || 'pieces',
      cost_per_unit: product.cost_per_unit || undefined,
      supplier_name: product.supplier_name || '',
      name: product.name,
      description: product.description || '',
      brand: product.brand || '',
      category: product.category || '',
    },
  });

  const handleEnhance = async () => {
    if (!onEnhance) return;
    
    setIsEnhancing(true);
    try {
      const enhanced = await onEnhance(product);
      setEnhancedData(enhanced);
      
      // Auto-fill enhanced data
      if (enhanced) {
        if (enhanced.description && !form.getValues('description')) {
          form.setValue('description', enhanced.description);
        }
        if (enhanced.brand && !form.getValues('brand')) {
          form.setValue('brand', enhanced.brand);
        }
        if (enhanced.category && !form.getValues('category')) {
          form.setValue('category', enhanced.category);
        }
        
        toast({
          title: "Product enhanced",
          description: "Found additional product information online",
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

  const handleSubmit = async (data: UpdateFormData) => {
    const updates: Partial<Product> = {
      name: data.name,
      description: data.description,
      brand: data.brand,
      category: data.category,
      cost_per_unit: data.cost_per_unit,
      supplier_name: data.supplier_name,
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
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Update Product: {product.name}
            <Badge variant="secondary">Current Stock: {currentStock}</Badge>
          </DialogTitle>
          <DialogDescription>
            Add inventory quantity and update product information
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="update" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="update">Update & Add Stock</TabsTrigger>
            <TabsTrigger value="enhance">Enhance Details</TabsTrigger>
          </TabsList>

          <TabsContent value="update" className="mt-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
                {/* Quantity Section */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Add to Inventory</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
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
                        name="unit"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Unit</FormLabel>
                            <FormControl>
                              <select 
                                {...field} 
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                              >
                                {UNITS.map((unit) => (
                                  <option key={unit} value={unit}>
                                    {unit}
                                  </option>
                                ))}
                              </select>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    {newQuantity > 0 && (
                      <div className="p-3 bg-muted rounded-md">
                        <p className="text-sm">
                          <strong>Stock Update Preview:</strong><br />
                          Current: {currentStock} → New Total: {totalAfterUpdate} {form.getValues('unit')}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Product Details Section */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Product Details</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Product Name</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
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
                            <Textarea {...field} rows={3} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="brand"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Brand</FormLabel>
                            <FormControl>
                              <Input {...field} />
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
                              <Input {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
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
                              <Input {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </CardContent>
                </Card>

                <div className="flex justify-end gap-2">
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => onOpenChange(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit">
                    Update Product
                  </Button>
                </div>
              </form>
            </Form>
          </TabsContent>

          <TabsContent value="enhance" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5" />
                  Enhance Product Details
                </CardTitle>
                <CardDescription>
                  Search online for additional product information and enhance details using AI
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Button 
                    onClick={handleEnhance}
                    disabled={isEnhancing || !onEnhance}
                    className="flex items-center gap-2"
                  >
                    {isEnhancing ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Enhancing...
                      </>
                    ) : (
                      <>
                        <Search className="h-4 w-4" />
                        Search & Enhance
                      </>
                    )}
                  </Button>
                </div>

                {enhancedData && (
                  <div className="p-4 bg-muted rounded-md">
                    <h4 className="font-medium mb-2">Enhanced Information Found:</h4>
                    <div className="space-y-2 text-sm">
                      {enhancedData.description && (
                        <div>
                          <strong>Description:</strong>
                          <p className="mt-1">{enhancedData.description}</p>
                        </div>
                      )}
                      {enhancedData.brand && (
                        <div>
                          <strong>Brand:</strong> {enhancedData.brand}
                        </div>
                      )}
                      {enhancedData.category && (
                        <div>
                          <strong>Category:</strong> {enhancedData.category}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="text-sm text-muted-foreground">
                  <p className="font-medium mb-2">Enhancement will search for:</p>
                  <ul className="space-y-1">
                    <li>• Detailed product descriptions</li>
                    <li>• Brand and manufacturer information</li>
                    <li>• Product categories and classifications</li>
                    <li>• Nutritional information (if applicable)</li>
                    <li>• Size and packaging details</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};