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
import { hasRecipeMapping, createRecipeByItemNameMap } from '@/utils/recipeMapping';
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
import { Check, ChevronsUpDown, CheckCircle2, AlertCircle, Receipt } from 'lucide-react';
import { cn } from '@/lib/utils';
import Fuse from 'fuse.js';

const saleSchema = z.object({
  itemName: z.string().min(1, 'Item name is required'),
  quantity: z.number().min(1, 'Quantity must be at least 1'),
  unitPrice: z.number().min(0, 'Unit price must be positive').optional(),
  totalPrice: z.number().min(0, 'Total price must be positive').optional(),
  saleDate: z.string().min(1, 'Sale date is required'),
  saleTime: z.string().optional(),
  adjustmentType: z.enum(['revenue', 'tax', 'tip', 'service_charge', 'discount', 'fee']).optional(),
  // Adjustment fields
  taxAmount: z.number().min(0, 'Tax must be positive').optional(),
  tipAmount: z.number().min(0, 'Tip must be positive').optional(),
  serviceChargeAmount: z.number().min(0, 'Service charge must be positive').optional(),
  discountAmount: z.number().min(0, 'Discount must be positive').optional(),
  feeAmount: z.number().min(0, 'Fee must be positive').optional(),
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
    unitPrice?: number;
    saleDate: string;
    saleTime?: string;
    adjustmentType?: 'tax' | 'tip' | 'service_charge' | 'discount' | 'fee' | null;
  } | null;
}

export const POSSaleDialog: React.FC<POSSaleDialogProps> = ({
  open,
  onOpenChange,
  restaurantId,
  editingSale = null,
}) => {
  const { createManualSale, createManualSaleWithAdjustments, updateManualSale } = useUnifiedSales(restaurantId);
  const { posItems, loading: posLoading, refetch: refetchPOSItems } = usePOSItems(restaurantId);
  const { recipes, loading: recipesLoading } = useRecipes(restaurantId);

  const [comboboxOpen, setComboboxOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const form = useForm<SaleFormValues>({
    resolver: zodResolver(saleSchema),
    defaultValues: editingSale || {
      itemName: '',
      quantity: 1,
      unitPrice: undefined,
      totalPrice: undefined,
      saleDate: new Date().toISOString().split('T')[0],
      saleTime: new Date().toTimeString().slice(0, 5),
      adjustmentType: 'revenue',
      taxAmount: undefined,
      tipAmount: undefined,
      serviceChargeAmount: undefined,
      discountAmount: undefined,
      feeAmount: undefined,
    },
  });

  // Update form when editingSale changes
  React.useEffect(() => {
    if (editingSale) {
      form.reset({
        itemName: editingSale.itemName,
        quantity: editingSale.quantity,
        unitPrice: editingSale.unitPrice,
        totalPrice: editingSale.totalPrice,
        saleDate: editingSale.saleDate,
        saleTime: editingSale.saleTime || '',
        adjustmentType: editingSale.adjustmentType ? editingSale.adjustmentType : 'revenue',
        taxAmount: undefined,
        tipAmount: undefined,
        serviceChargeAmount: undefined,
        discountAmount: undefined,
        feeAmount: undefined,
      });
    } else {
      form.reset({
        itemName: '',
        quantity: 1,
        unitPrice: undefined,
        totalPrice: undefined,
        saleDate: new Date().toISOString().split('T')[0],
        saleTime: new Date().toTimeString().slice(0, 5),
        adjustmentType: 'revenue',
        taxAmount: undefined,
        tipAmount: undefined,
        serviceChargeAmount: undefined,
        discountAmount: undefined,
        feeAmount: undefined,
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

    // Create recipe mapping for quick lookup (uses tested utility)
    const recipeMap = createRecipeByItemNameMap(recipes);

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

    // Add POS items that don't have recipes (uses tested utility)
    posItems.forEach(posItem => {
      if (!hasRecipeMapping(posItem.item_name, recipeMap)) {
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

  // Calculate total collected at POS (revenue + adjustments - discounts)
  const totalCollected = useMemo(() => {
    const revenue = form.watch('totalPrice') || 0;
    const tax = form.watch('taxAmount') || 0;
    const tip = form.watch('tipAmount') || 0;
    const serviceCharge = form.watch('serviceChargeAmount') || 0;
    const discount = form.watch('discountAmount') || 0;
    const fee = form.watch('feeAmount') || 0;

    return revenue + tax + tip + serviceCharge - discount + fee;
  }, [
    form.watch('totalPrice'),
    form.watch('taxAmount'),
    form.watch('tipAmount'),
    form.watch('serviceChargeAmount'),
    form.watch('discountAmount'),
    form.watch('feeAmount')
  ]);

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

    // If editing, use the old single-entry method
    if (editingSale) {
      // Convert 'revenue' to null for the adjustmentType
      const adjustmentType = values.adjustmentType === 'revenue' ? null : values.adjustmentType as 'tax' | 'tip' | 'service_charge' | 'discount' | 'fee' | undefined;

      success = await updateManualSale(editingSale.id, {
        itemName: values.itemName,
        quantity: values.quantity,
        unitPrice: values.unitPrice,
        totalPrice: values.totalPrice,
        saleDate: values.saleDate,
        saleTime: values.saleTime,
        adjustmentType,
      });
    } else {
      // Check if any adjustments are provided
      const hasAdjustments =
        (values.taxAmount && values.taxAmount > 0) ||
        (values.tipAmount && values.tipAmount > 0) ||
        (values.serviceChargeAmount && values.serviceChargeAmount > 0) ||
        (values.discountAmount && values.discountAmount > 0) ||
        (values.feeAmount && values.feeAmount > 0);

      if (hasAdjustments) {
        // Use batch creation with adjustments
        success = await createManualSaleWithAdjustments({
          itemName: values.itemName,
          quantity: values.quantity,
          unitPrice: values.unitPrice,
          totalPrice: values.totalPrice,
          saleDate: values.saleDate,
          saleTime: values.saleTime,
          adjustments: {
            tax: values.taxAmount,
            tip: values.tipAmount,
            serviceCharge: values.serviceChargeAmount,
            discount: values.discountAmount,
            fee: values.feeAmount,
          },
        });
      } else {
        // Use single creation (no adjustments)
        success = await createManualSale({
          itemName: values.itemName,
          quantity: values.quantity,
          unitPrice: values.unitPrice,
          totalPrice: values.totalPrice,
          saleDate: values.saleDate,
          saleTime: values.saleTime,
          adjustmentType: null,
        });
      }
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
      <DialogContent className="sm:max-w-md p-0 gap-0 border-border/40">
        {/* Apple-style header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <Receipt className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">
                {editingSale ? 'Edit Manual Sale' : 'Record Manual Sale'}
              </DialogTitle>
              <p className="text-[13px] text-muted-foreground mt-0.5">
                {editingSale ? 'Update the sale details below.' : 'Add a new sale entry manually.'}
              </p>
            </div>
          </div>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="px-6 py-5 space-y-5">
            {/* Item Name Field */}
            <FormField
              control={form.control}
              name="itemName"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                    Item Name
                  </FormLabel>
                  <Popover open={comboboxOpen} onOpenChange={setComboboxOpen}>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={comboboxOpen}
                          className={cn(
                            "w-full h-10 justify-between font-normal rounded-lg border-border/40 bg-muted/30 hover:bg-muted/50",
                            !field.value && "text-muted-foreground"
                          )}
                        >
                          {field.value ? (
                            <span className="flex items-center gap-2">
                              {selectedItemData?.hasRecipe ? (
                                <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                              ) : (
                                <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                              )}
                              <span className="text-[14px]">{field.value}</span>
                            </span>
                          ) : (
                            <span className="text-[14px]">Select or type an item...</span>
                          )}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground/50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent
                      className="w-[--radix-popover-trigger-width] p-0 border-border/40"
                      align="start"
                      sideOffset={4}
                    >
                      <Command shouldFilter={false}>
                        <CommandInput
                          placeholder="Search items..."
                          value={searchQuery}
                          onValueChange={setSearchQuery}
                          className="text-[14px]"
                        />
                        <CommandList className="max-h-[300px]">
                          <CommandEmpty>
                            {posLoading || recipesLoading ? (
                              <div className="flex flex-col items-center justify-center py-8">
                                <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-foreground/70" />
                                <p className="mt-2 text-[13px] text-muted-foreground">Loading items...</p>
                              </div>
                            ) : searchQuery ? (
                              <div className="p-3 space-y-2">
                                <p className="text-[13px] text-muted-foreground text-center">
                                  No existing items match "{searchQuery}"
                                </p>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="w-full justify-start gap-2 h-9 rounded-lg border-border/40"
                                  onClick={() => handleCreateNewItem(searchQuery)}
                                >
                                  <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                                  <span className="text-[13px]">Create: <strong>"{searchQuery}"</strong></span>
                                </Button>
                              </div>
                            ) : (
                              <div className="py-8 text-center">
                                <p className="text-[13px] text-muted-foreground">
                                  Start typing to search or create
                                </p>
                              </div>
                            )}
                          </CommandEmpty>

                          {filteredItems.length > 0 && (
                            <>
                              <CommandGroup heading="Items with Recipe">
                                {filteredItems
                                  .filter(item => item.hasRecipe)
                                  .map((item) => (
                                    <CommandItem
                                      key={item.value}
                                      value={item.value}
                                      onSelect={() => handleItemSelect(item.value)}
                                      className="py-2.5"
                                    >
                                      <Check
                                        className={cn(
                                          "mr-2 h-4 w-4",
                                          field.value === item.value
                                            ? "opacity-100"
                                            : "opacity-0"
                                        )}
                                      />
                                      <CheckCircle2 className="mr-2 h-4 w-4 text-green-600 dark:text-green-400" />
                                      <div className="flex flex-col flex-1">
                                        <div className="flex items-center justify-between gap-2">
                                          <span className="text-[14px]">{item.label}</span>
                                          <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
                                            {item.source}
                                          </span>
                                        </div>
                                        {item.avgPrice && (
                                          <span className="text-[12px] text-muted-foreground">
                                            Avg: ${item.avgPrice.toFixed(2)}
                                          </span>
                                        )}
                                      </div>
                                    </CommandItem>
                                  ))}
                              </CommandGroup>

                              {filteredItems.some(item => !item.hasRecipe) && (
                                <CommandGroup heading="Items without Recipe">
                                  {filteredItems
                                    .filter(item => !item.hasRecipe)
                                    .map((item) => (
                                      <CommandItem
                                        key={item.value}
                                        value={item.value}
                                        onSelect={() => handleItemSelect(item.value)}
                                        className="py-2.5"
                                      >
                                        <Check
                                          className={cn(
                                            "mr-2 h-4 w-4",
                                            field.value === item.value
                                              ? "opacity-100"
                                              : "opacity-0"
                                          )}
                                        />
                                        <AlertCircle className="mr-2 h-4 w-4 text-amber-600 dark:text-amber-400" />
                                        <div className="flex items-center justify-between gap-2 flex-1">
                                          <span className="text-[14px]">{item.label}</span>
                                          <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
                                            {item.source}
                                          </span>
                                        </div>
                                      </CommandItem>
                                    ))}
                                </CommandGroup>
                              )}
                            </>
                          )}

                          {searchQuery && (
                            <CommandGroup heading="Create New">
                              <CommandItem
                                onSelect={() => handleCreateNewItem(searchQuery)}
                                className="cursor-pointer py-2.5"
                              >
                                <AlertCircle className="mr-2 h-4 w-4 text-muted-foreground" />
                                <span className="text-[13px]">Create new: <strong>"{searchQuery}"</strong></span>
                              </CommandItem>
                            </CommandGroup>
                          )}
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  {selectedItemData && !selectedItemData.hasRecipe && (
                    <FormDescription className="flex items-center gap-1.5 text-[12px] text-amber-600 dark:text-amber-400">
                      <AlertCircle className="h-3 w-3" />
                      No recipe mapping - inventory won't be deducted
                    </FormDescription>
                  )}
                  {selectedItemData?.hasRecipe && (
                    <FormDescription className="flex items-center gap-1.5 text-[12px] text-green-600 dark:text-green-400">
                      <CheckCircle2 className="h-3 w-3" />
                      Recipe mapped - inventory will be deducted
                    </FormDescription>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Quantity and Price Row */}
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="quantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                      Quantity
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="1"
                        {...field}
                        onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                        className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="unitPrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                      Unit Price
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        {...field}
                        value={field.value ?? ''}
                        onChange={(e) => field.onChange(parseFloat(e.target.value) || undefined)}
                        className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Total Price */}
            <FormField
              control={form.control}
              name="totalPrice"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                    Total Price
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(parseFloat(e.target.value) || undefined)}
                      className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                    />
                  </FormControl>
                  <FormDescription className="text-[11px] text-muted-foreground">
                    Optional - calculated from Unit Price × Quantity if empty
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Date and Time Row */}
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="saleDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                      Sale Date
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        {...field}
                        className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                      />
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
                    <FormLabel className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                      Sale Time
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="time"
                        {...field}
                        className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Adjustments Section - Only for new sales */}
            {!editingSale && (
              <div className="space-y-4 pt-4 border-t border-border/40">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                    Adjustments
                  </span>
                  <span className="text-[11px] text-muted-foreground">Optional</span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="taxAmount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-[12px] font-medium text-foreground">Sales Tax</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            {...field}
                            value={field.value ?? ''}
                            onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                            className="h-9 text-[13px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="tipAmount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-[12px] font-medium text-foreground">Tip</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            {...field}
                            value={field.value ?? ''}
                            onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                            className="h-9 text-[13px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="serviceChargeAmount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-[12px] font-medium text-foreground">Service Charge</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            {...field}
                            value={field.value ?? ''}
                            onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                            className="h-9 text-[13px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="feeAmount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-[12px] font-medium text-foreground">Platform Fee</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            {...field}
                            value={field.value ?? ''}
                            onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                            className="h-9 text-[13px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="discountAmount"
                    render={({ field }) => (
                      <FormItem className="col-span-2">
                        <FormLabel className="text-[12px] font-medium text-foreground">Discount</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            {...field}
                            value={field.value ?? ''}
                            onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                            className="h-9 text-[13px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {totalCollected > 0 && (
                  <div className="p-4 bg-muted/30 rounded-xl border border-border/40">
                    <div className="flex justify-between items-center">
                      <span className="text-[13px] font-medium text-muted-foreground">Total Collected at POS</span>
                      <span className="text-[18px] font-semibold text-foreground tabular-nums">
                        ${totalCollected.toFixed(2)}
                      </span>
                    </div>
                    <div className="mt-2 text-[11px] text-muted-foreground">
                      {(() => {
                        const parts = [];
                        const revenue = form.watch('totalPrice') || 0;
                        if (revenue > 0) parts.push(`$${revenue.toFixed(2)} revenue`);

                        const tax = form.watch('taxAmount') || 0;
                        if (tax > 0) parts.push(`$${tax.toFixed(2)} tax`);

                        const tip = form.watch('tipAmount') || 0;
                        if (tip > 0) parts.push(`$${tip.toFixed(2)} tip`);

                        const serviceCharge = form.watch('serviceChargeAmount') || 0;
                        if (serviceCharge > 0) parts.push(`$${serviceCharge.toFixed(2)} service charge`);

                        const fee = form.watch('feeAmount') || 0;
                        if (fee > 0) parts.push(`$${fee.toFixed(2)} fee`);

                        const discount = form.watch('discountAmount') || 0;
                        if (discount > 0) parts.push(`-$${discount.toFixed(2)} discount`);

                        return parts.join(' + ');
                      })()}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Footer Actions */}
            <div className="flex gap-2 pt-4 border-t border-border/40">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                className="flex-1 h-10 rounded-lg text-[14px] font-medium text-muted-foreground hover:text-foreground"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={form.formState.isSubmitting}
                className="flex-1 h-10 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[14px] font-medium"
              >
                {form.formState.isSubmitting
                  ? (editingSale ? 'Updating...' : 'Recording...')
                  : (editingSale ? 'Update Sale' : 'Record Sale')}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
