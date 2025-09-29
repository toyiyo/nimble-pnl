import React, { useState, useMemo } from 'react';
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
  FormDescription,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useUnifiedSales } from '@/hooks/useUnifiedSales';
import { usePOSItems } from '@/hooks/usePOSItems';
import { useRecipes } from '@/hooks/useRecipes';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Check, ChevronsUpDown, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import Fuse from 'fuse.js';

const saleSchema = z.object({
  itemName: z.string().min(1, 'Item name is required'),
  quantity: z.number().min(1, 'Quantity must be at least 1'),
  totalPrice: z.number().min(0, 'Price must be positive').optional(),
  saleDate: z.string().min(1, 'Sale date is required'),
  saleTime: z.string().optional(),
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
  const { createManualSale } = useUnifiedSales(restaurantId);
  const { posItems, loading: posLoading } = usePOSItems(restaurantId);
  const { recipes, loading: recipesLoading } = useRecipes(restaurantId);
  
  const [comboboxOpen, setComboboxOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const form = useForm<SaleFormValues>({
    resolver: zodResolver(saleSchema),
    defaultValues: {
      itemName: '',
      quantity: 1,
      totalPrice: undefined,
      saleDate: new Date().toISOString().split('T')[0],
      saleTime: new Date().toTimeString().slice(0, 5),
    },
  });

  // Combine recipes and POS items into searchable list
  const searchableItems = useMemo(() => {
    const items: Array<{
      value: string;
      label: string;
      hasRecipe: boolean;
      recipeId?: string;
      avgPrice?: number;
      source: 'recipe' | 'pos_item';
    }> = [];

    // Add recipes (these have mappings by definition)
    recipes.forEach(recipe => {
      if (recipe.pos_item_name) {
        items.push({
          value: recipe.pos_item_name,
          label: recipe.pos_item_name,
          hasRecipe: true,
          recipeId: recipe.id,
          avgPrice: recipe.avg_sale_price,
          source: 'recipe',
        });
      }
    });

    // Add POS items that don't have recipes
    posItems.forEach(posItem => {
      const hasRecipe = recipes.some(r => 
        r.pos_item_name?.toLowerCase() === posItem.item_name.toLowerCase()
      );
      
      if (!hasRecipe) {
        items.push({
          value: posItem.item_name,
          label: posItem.item_name,
          hasRecipe: false,
          source: 'pos_item',
        });
      }
    });

    return items;
  }, [recipes, posItems]);

  // Fuzzy search implementation
  const fuse = useMemo(() => {
    return new Fuse(searchableItems, {
      keys: ['label'],
      threshold: 0.3,
      includeScore: true,
    });
  }, [searchableItems]);

  const filteredItems = useMemo(() => {
    if (!searchQuery) return searchableItems;
    
    const results = fuse.search(searchQuery);
    return results.map(result => result.item);
  }, [searchQuery, fuse, searchableItems]);

  // Find if selected item has recipe mapping
  const selectedItemData = useMemo(() => {
    const itemName = form.watch('itemName');
    return searchableItems.find(item => item.value === itemName);
  }, [form.watch('itemName'), searchableItems]);

  // Auto-fill price when item is selected
  const handleItemSelect = (itemValue: string) => {
    const item = searchableItems.find(i => i.value === itemValue);
    form.setValue('itemName', itemValue);
    
    if (item?.avgPrice) {
      form.setValue('totalPrice', item.avgPrice);
    }
    
    setComboboxOpen(false);
  };

  const onSubmit = async (values: SaleFormValues) => {
    const success = await createManualSale({
      itemName: values.itemName,
      quantity: values.quantity,
      totalPrice: values.totalPrice,
      saleDate: values.saleDate,
      saleTime: values.saleTime,
    });

    if (success) {
      form.reset();
      setSearchQuery('');
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record Manual Sale</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="itemName"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Item Name *</FormLabel>
                  <Popover open={comboboxOpen} onOpenChange={setComboboxOpen}>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={comboboxOpen}
                          className={cn(
                            "w-full justify-between font-normal",
                            !field.value && "text-muted-foreground"
                          )}
                        >
                          {field.value ? (
                            <span className="flex items-center gap-2">
                              {selectedItemData?.hasRecipe ? (
                                <CheckCircle2 className="h-4 w-4 text-success" />
                              ) : (
                                <AlertCircle className="h-4 w-4 text-warning" />
                              )}
                              {field.value}
                            </span>
                          ) : (
                            "Select or type an item..."
                          )}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-full p-0" align="start">
                      <Command shouldFilter={false}>
                        <CommandInput 
                          placeholder="Search items..." 
                          value={searchQuery}
                          onValueChange={setSearchQuery}
                        />
                        <CommandList>
                          <CommandEmpty>
                            {posLoading || recipesLoading ? (
                              "Loading..."
                            ) : (
                              <div className="p-2 text-center text-sm">
                                No items found. Type to create new item: "{searchQuery}"
                                {searchQuery && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="mt-2 w-full"
                                    onClick={() => {
                                      form.setValue('itemName', searchQuery);
                                      setComboboxOpen(false);
                                    }}
                                  >
                                    Use "{searchQuery}"
                                  </Button>
                                )}
                              </div>
                            )}
                          </CommandEmpty>
                          
                          {filteredItems.length > 0 && (
                            <>
                              <CommandGroup heading="Items with Recipe Mapping">
                                {filteredItems
                                  .filter(item => item.hasRecipe)
                                  .map((item) => (
                                    <CommandItem
                                      key={item.value}
                                      value={item.value}
                                      onSelect={() => handleItemSelect(item.value)}
                                    >
                                      <Check
                                        className={cn(
                                          "mr-2 h-4 w-4",
                                          field.value === item.value
                                            ? "opacity-100"
                                            : "opacity-0"
                                        )}
                                      />
                                      <CheckCircle2 className="mr-2 h-4 w-4 text-success" />
                                      <div className="flex flex-col">
                                        <span>{item.label}</span>
                                        {item.avgPrice && (
                                          <span className="text-xs text-muted-foreground">
                                            Avg: ${item.avgPrice.toFixed(2)}
                                          </span>
                                        )}
                                      </div>
                                    </CommandItem>
                                  ))}
                              </CommandGroup>
                              
                              {filteredItems.some(item => !item.hasRecipe) && (
                                <CommandGroup heading="Items without Recipe Mapping">
                                  {filteredItems
                                    .filter(item => !item.hasRecipe)
                                    .map((item) => (
                                      <CommandItem
                                        key={item.value}
                                        value={item.value}
                                        onSelect={() => handleItemSelect(item.value)}
                                      >
                                        <Check
                                          className={cn(
                                            "mr-2 h-4 w-4",
                                            field.value === item.value
                                              ? "opacity-100"
                                              : "opacity-0"
                                          )}
                                        />
                                        <AlertCircle className="mr-2 h-4 w-4 text-warning" />
                                        <span>{item.label}</span>
                                      </CommandItem>
                                    ))}
                                </CommandGroup>
                              )}
                            </>
                          )}
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  {selectedItemData && !selectedItemData.hasRecipe && (
                    <FormDescription className="flex items-center gap-1 text-warning">
                      <AlertCircle className="h-3 w-3" />
                      No recipe mapping - inventory won't be deducted
                    </FormDescription>
                  )}
                  {selectedItemData?.hasRecipe && (
                    <FormDescription className="flex items-center gap-1 text-success">
                      <CheckCircle2 className="h-3 w-3" />
                      Recipe mapped - inventory will be deducted
                    </FormDescription>
                  )}
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
                name="totalPrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Total Price</FormLabel>
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
                name="saleDate"
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
                name="saleTime"
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