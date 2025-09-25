import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import { usePOSSales, CreatePOSSaleData } from '@/hooks/usePOSSales';

const saleSchema = z.object({
  pos_item_name: z.string().min(1, 'Item name is required'),
  pos_item_id: z.string().optional(),
  quantity: z.number().min(1, 'Quantity must be at least 1'),
  sale_price: z.number().min(0, 'Price must be positive').optional(),
  sale_date: z.string().min(1, 'Sale date is required'),
  sale_time: z.string().optional(),
});

type SaleFormValues = z.infer<typeof saleSchema>;

interface POSSaleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string;
}

export const POSSaleDialog: React.FC<POSSaleDialogProps> = ({
  open,
  onOpenChange,
  restaurantId,
}) => {
  const { createSale } = usePOSSales(restaurantId);

  const form = useForm<SaleFormValues>({
    resolver: zodResolver(saleSchema),
    defaultValues: {
      pos_item_name: '',
      pos_item_id: '',
      quantity: 1,
      sale_price: undefined,
      sale_date: new Date().toISOString().split('T')[0],
      sale_time: new Date().toTimeString().slice(0, 5),
    },
  });

  const onSubmit = async (values: SaleFormValues) => {
    const saleData: CreatePOSSaleData = {
      restaurant_id: restaurantId,
      pos_item_name: values.pos_item_name,
      pos_item_id: values.pos_item_id || undefined,
      quantity: values.quantity,
      sale_price: values.sale_price || undefined,
      sale_date: values.sale_date,
      sale_time: values.sale_time || undefined,
    };

    const success = await createSale(saleData);
    if (success) {
      form.reset();
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record POS Sale</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="pos_item_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Item Name *</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g., Cheeseburger, Coffee" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="pos_item_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>POS Item ID</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Optional POS system ID" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="quantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quantity *</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="1"
                        {...field}
                        onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="sale_price"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sale Price</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        {...field}
                        onChange={(e) => field.onChange(parseFloat(e.target.value) || undefined)}
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
                name="sale_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sale Date *</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="sale_time"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sale Time</FormLabel>
                    <FormControl>
                      <Input type="time" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Recording...' : 'Record Sale'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};