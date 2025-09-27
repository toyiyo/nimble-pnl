import React from 'react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useInventoryAudit } from '@/hooks/useInventoryAudit';
import { useToast } from '@/hooks/use-toast';
import { AlertTriangle, Calendar } from 'lucide-react';
import { Product } from '@/hooks/useProducts';
import { supabase } from '@/integrations/supabase/client';

const wasteSchema = z.object({
  quantity: z.coerce.number().min(0.1, 'Quantity must be greater than 0'),
  reason: z.string().min(1, 'Reason is required'),
  wasteType: z.enum(['expired', 'damaged', 'spoiled', 'spilled', 'contaminated', 'other']),
  expiryDate: z.string().optional(),
  notes: z.string().optional(),
});

type WasteFormData = z.infer<typeof wasteSchema>;

interface WasteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product;
  restaurantId: string;
  onWasteReported?: () => void;
}

const WASTE_TYPES = [
  { value: 'expired', label: 'Expired' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'spoiled', label: 'Spoiled' },
  { value: 'spilled', label: 'Spilled' },
  { value: 'contaminated', label: 'Contaminated' },
  { value: 'other', label: 'Other' }
];

export function WasteDialog({ open, onOpenChange, product, restaurantId, onWasteReported }: WasteDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { updateProductStockWithAudit } = useInventoryAudit();
  const { toast } = useToast();

  const form = useForm<WasteFormData>({
    resolver: zodResolver(wasteSchema),
    defaultValues: {
      quantity: 1,
      reason: '',
      wasteType: 'other',
      expiryDate: '',
      notes: '',
    }
  });

  const handleSubmit = async (data: WasteFormData) => {
    setIsSubmitting(true);

    try {
      const currentStock = product.current_stock || 0;
      const wasteQuantity = data.quantity;

      if (wasteQuantity > currentStock) {
        toast({
          title: "Invalid quantity",
          description: `Cannot waste ${wasteQuantity} units. Only ${currentStock} units in stock.`,
          variant: "destructive",
        });
        return;
      }

      const newStock = currentStock - wasteQuantity;
      const unitCost = product.cost_per_unit || 0;
      
      const wasteReason = `${WASTE_TYPES.find(t => t.value === data.wasteType)?.label}: ${data.reason}${data.notes ? ` - ${data.notes}` : ''}`;

      const success = await updateProductStockWithAudit(
        restaurantId,
        product.id,
        newStock,
        currentStock,
        unitCost,
        'waste',
        wasteReason,
        `waste_${Date.now()}`
      );

      if (success) {
        toast({
          title: "Waste reported",
          description: `${wasteQuantity} ${product.size_unit || 'units'} of ${product.name} marked as waste`,
        });
        
        form.reset();
        onOpenChange(false);
        onWasteReported?.();
      }
    } catch (error) {
      console.error('Error reporting waste:', error);
      toast({
        title: "Error",
        description: "Failed to report waste",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-600" />
            Report Waste: {product.name}
          </DialogTitle>
          <DialogDescription>
            Report damaged, expired, or wasted inventory. This will reduce stock levels and create an audit trail.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="quantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quantity</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        min="0.1"
                        step="0.1"
                        max={product.current_stock}
                        placeholder="Enter quantity"
                      />
                    </FormControl>
                    <FormMessage />
                    <p className="text-xs text-muted-foreground">
                      Available: {product.current_stock || 0} {product.size_unit || 'units'}
                    </p>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="wasteType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Waste Type</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {WASTE_TYPES.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            {type.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Brief description of why item was wasted"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {form.watch('wasteType') === 'expired' && (
              <FormField
                control={form.control}
                name="expiryDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <Calendar className="h-4 w-4" />
                      Expiry Date
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="date"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Additional Notes (Optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder="Additional details about the waste..."
                      rows={3}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="bg-orange-50 border border-orange-200 rounded p-3">
              <p className="text-sm text-orange-800">
                <strong>Impact:</strong> This will reduce stock by {form.watch('quantity') || 0} units 
                and record a waste transaction of ${((form.watch('quantity') || 0) * (product.cost_per_unit || 0)).toFixed(2)}
              </p>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Reporting..." : "Report Waste"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}