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
  editingSale?: {
    id: string;
    itemName: string;
    quantity: number;
    totalPrice?: number;
    saleDate: string;
    saleTime?: string;
  } | null;
}

export const POSSaleDialog: React.FC<POSSaleDialogProps> = ({
  open,
  onOpenChange,
  restaurantId,
  editingSale = null,
}) => {
  const { createManualSale, updateManualSale } = useUnifiedSales(restaurantId);
  const { posItems, loading: posLoading, refetch: refetchPOSItems } = usePOSItems(restaurantId);
  const { recipes, loading: recipesLoading } = useRecipes(restaurantId);
  
  const [comboboxOpen, setComboboxOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const form = useForm<SaleFormValues>({
    resolver: zodResolver(saleSchema),
    defaultValues: editingSale || {
      itemName: '',
      quantity: 1,
      totalPrice: undefined,
      saleDate: new Date().toISOString().split('T')[0],
      saleTime: new Date().toTimeString().slice(0, 5),
    },
  });

  // Update form when editingSale changes
  React.useEffect(() => {
    if (editingSale) {
      form.reset({
        itemName: editingSale.itemName,
        quantity: editingSale.quantity,
        totalPrice: editingSale.totalPrice,
        saleDate: editingSale.saleDate,
        saleTime: editingSale.saleTime || '',
      });
    } else {
      form.reset({
        itemName: '',
        quantity: 1,
        totalPrice: undefined,
        saleDate: new Date().toISOString().split('T')[0],
        saleTime: new Date().toTimeString().slice(0, 5),
      });
    }
  }, [editingSale, form]);

  // Combine recipes and POS items into searchable list
  const searchableItems = useMemo(() => {
    const items: Array<{
      value: string;
      label: string;
      hasRecipe: boolean;
      recipeId?: string;
      avgPrice?: number;
      source: string;
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
          source: 'Recipe',
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
          source: posItem.source === 'pos_sales' ? 'Manual' : 'POS',
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

  // Handle creating new item with duplicate prevention
  const handleCreateNewItem = (newItemName: string) => {
    // Check for case-insensitive match
    const existingItem = searchableItems.find(
      item => item.value.toLowerCase() === newItemName.toLowerCase()
    );
    
    if (existingItem) {
      // Use the existing item's proper casing
      form.setValue('itemName', existingItem.value);
      if (existingItem.avgPrice) {
        form.setValue('totalPrice', existingItem.avgPrice);
      }
    } else {
      // Create new item with user's input
      form.setValue('itemName', newItemName);
    }
    
    setComboboxOpen(false);
  };

  const onSubmit = async (values: SaleFormValues) => {
    let success = false;
    
    if (editingSale) {
      success = await updateManualSale(editingSale.id, {
        itemName: values.itemName,
        quantity: values.quantity,
        totalPrice: values.totalPrice,
        saleDate: values.saleDate,
        saleTime: values.saleTime,
      });
    } else {
      success = await createManualSale({
        itemName: values.itemName,
        quantity: values.quantity,
        totalPrice: values.totalPrice,
        saleDate: values.saleDate,
        saleTime: values.saleTime,
      });
    }

    if (success) {
      // Refresh POS items list to include the newly created item
      await refetchPOSItems();
      form.reset();
      setSearchQuery('');
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editingSale ? 'Edit Manual Sale' : 'Record Manual Sale'}</DialogTitle>
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
                    <PopoverContent 
                      className="w-[--radix-popover-trigger-width] p-0" 
                      align="start"
                      sideOffset={4}
                    >
                      <Command shouldFilter={false}>
                        <CommandInput 
                          placeholder="Search items..." 
                          value={searchQuery}
                          onValueChange={setSearchQuery}
                        />
                        <CommandList className="max-h-[300px]">
                          <CommandEmpty>
                            {posLoading || recipesLoading ? (
                              <div className="p-4 text-center text-sm text-muted-foreground">
                                Loading items...
                              </div>
                            ) : searchQuery ? (
                              <div className="p-3 space-y-2">
                                <p className="text-sm text-muted-foreground text-center">
                                  No existing items match "{searchQuery}"
                                </p>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="w-full justify-start gap-2"
                                  onClick={() => handleCreateNewItem(searchQuery)}
                                >
                                  <AlertCircle className="h-4 w-4" />
                                  Create new manual item: <strong>"{searchQuery}"</strong>
                                </Button>
                              </div>
                            ) : (
                              <div className="p-4 text-center text-sm text-muted-foreground">
                                Start typing to search or create a new item
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
                                      <div className="flex flex-col flex-1">
                                        <div className="flex items-center justify-between gap-2">
                                          <span>{item.label}</span>
                                          <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                            {item.source}
                                          </span>
                                        </div>
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
                                        <div className="flex items-center justify-between gap-2 flex-1">
                                          <span>{item.label}</span>
                                          <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                            {item.source}
                                          </span>
                                        </div>
                                      </CommandItem>
                                    ))}
                                </CommandGroup>
                              )}
                              
                              {searchQuery && !filteredItems.some(item => item.value.toLowerCase() === searchQuery.toLowerCase()) && (
                                <CommandGroup heading="Create New">
                                  <CommandItem
                                    onSelect={() => handleCreateNewItem(searchQuery)}
                                    className="cursor-pointer"
                                  >
                                    <AlertCircle className="mr-2 h-4 w-4 text-muted-foreground" />
                                    <span>Create new item: <strong>"{searchQuery}"</strong></span>
                                  </CommandItem>
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
                {form.formState.isSubmitting 
                  ? (editingSale ? 'Updating...' : 'Recording...') 
                  : (editingSale ? 'Update Sale' : 'Record Sale')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};