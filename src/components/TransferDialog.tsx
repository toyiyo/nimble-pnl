import React from 'react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useInventoryAudit } from '@/hooks/useInventoryAudit';
import { useToast } from '@/hooks/use-toast';
import { ArrowRightLeft } from 'lucide-react';
import { Product } from '@/hooks/useProducts';
import { LocationCombobox } from '@/components/LocationCombobox';

const transferSchema = z.object({
  quantity: z.coerce.number().min(0.1, 'Quantity must be greater than 0'),
  fromLocation: z.string().min(1, 'Source location is required'),
  toLocation: z.string().min(1, 'Destination location is required'),
  reason: z.string().min(1, 'Reason is required'),
  notes: z.string().optional(),
}).refine((data) => data.fromLocation !== data.toLocation, {
  message: "Source and destination locations must be different",
  path: ["toLocation"],
});

type TransferFormData = z.infer<typeof transferSchema>;

interface TransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product;
  restaurantId: string;
  onTransferCompleted?: () => void;
}

export function TransferDialog({ open, onOpenChange, product, restaurantId, onTransferCompleted }: TransferDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { logTransfer } = useInventoryAudit();
  const { toast } = useToast();

  const form = useForm<TransferFormData>({
    resolver: zodResolver(transferSchema),
    defaultValues: {
      quantity: 1,
      fromLocation: '',
      toLocation: '',
      reason: '',
      notes: '',
    }
  });

  const handleSubmit = async (data: TransferFormData) => {
    setIsSubmitting(true);

    try {
      const currentStock = product.current_stock || 0;
      const transferQuantity = data.quantity;

      if (transferQuantity > currentStock) {
        toast({
          title: "Invalid quantity",
          description: `Cannot transfer ${transferQuantity} units. Only ${currentStock} units in stock.`,
          variant: "destructive",
        });
        return;
      }

      const unitCost = product.cost_per_unit || 0;
      const fromLocationLabel = data.fromLocation;
      const toLocationLabel = data.toLocation;
      
      const transferReason = `${data.reason}${data.notes ? ` - ${data.notes}` : ''}`;

      const success = await logTransfer(
        restaurantId,
        product.id,
        transferQuantity,
        unitCost,
        fromLocationLabel,
        toLocationLabel,
        transferReason,
        `transfer_${Date.now()}`
      );

      if (success) {
        toast({
          title: "Transfer completed",
          description: `${transferQuantity} ${product.size_unit || 'units'} of ${product.name} transferred from ${fromLocationLabel} to ${toLocationLabel}`,
        });
        
        form.reset();
        onOpenChange(false);
        onTransferCompleted?.();
      }
    } catch (error) {
      console.error('Error completing transfer:', error);
      toast({
        title: "Error",
        description: "Failed to complete transfer",
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
            <ArrowRightLeft className="h-5 w-5 text-blue-600" />
            Transfer: {product.name}
          </DialogTitle>
          <DialogDescription>
            Move inventory between storage locations or areas. This creates an audit trail without changing total stock.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="quantity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Quantity to Transfer</FormLabel>
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

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="fromLocation"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>From Location</FormLabel>
                    <FormControl>
                      <LocationCombobox
                        restaurantId={restaurantId}
                        value={field.value}
                        onValueChange={field.onChange}
                        placeholder="Select source"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="toLocation"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>To Location</FormLabel>
                    <FormControl>
                      <LocationCombobox
                        restaurantId={restaurantId}
                        value={field.value}
                        onValueChange={field.onChange}
                        placeholder="Select destination"
                      />
                    </FormControl>
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
                  <FormLabel>Reason for Transfer</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="e.g., Restocking, Organization, Daily prep"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Additional Notes (Optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder="Additional details about the transfer..."
                      rows={3}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {form.watch('fromLocation') && form.watch('toLocation') && (
              <div className="bg-blue-50 border border-blue-200 rounded p-3">
                <p className="text-sm text-blue-800">
                  <strong>Transfer Summary:</strong><br />
                  {form.watch('quantity') || 0} {product.size_unit || 'units'} from{' '}
                  {form.watch('fromLocation')} to{' '}
                  {form.watch('toLocation')}
                  <br />
                  <span className="text-xs">This will create two audit entries (OUT/IN) but won't change total stock.</span>
                </p>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Processing..." : "Complete Transfer"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}