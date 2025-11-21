import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, Send, Plus, Trash2, Search, AlertCircle, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { usePurchaseOrders } from '@/hooks/usePurchaseOrders';
import { useSuppliers } from '@/hooks/useSuppliers';
import { useProducts, Product } from '@/hooks/useProducts';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import {
  PurchaseOrderViewModel,
  PurchaseOrderLine,
  CreatePurchaseOrderLineData,
} from '@/types/purchaseOrder';
import { cn } from '@/lib/utils';

export const PurchaseOrderEditor: React.FC = () => {
  const navigate = useNavigate();
  const { id: poId } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id || null;

  const {
    createPurchaseOrder,
    updatePurchaseOrder,
    fetchPurchaseOrder,
    addLineItem,
    updateLineItem,
    deleteLineItem,
  } = usePurchaseOrders();
  const { suppliers, loading: suppliersLoading } = useSuppliers();
  const { products, loading: productsLoading } = useProducts(restaurantId);

  // State
  const [loading, setLoading] = useState(false);
  const [po, setPo] = useState<PurchaseOrderViewModel | null>(null);
  const [supplierId, setSupplierId] = useState<string>('');
  const [budget, setBudget] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [lines, setLines] = useState<PurchaseOrderLine[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [changeSupplierDialog, setChangeSupplierDialog] = useState(false);
  const [pendingSupplierId, setPendingSupplierId] = useState<string>('');

  const isNew = poId === 'new';
  const isEditing = !isNew;

  // Load existing PO
  useEffect(() => {
    if (isEditing && poId) {
      setLoading(true);
      fetchPurchaseOrder(poId)
        .then((data) => {
          if (data) {
            setPo(data);
            setSupplierId(data.supplier_id);
            setBudget(data.budget?.toString() || '');
            setNotes(data.notes || '');
            setLines(data.lines || []);
          }
        })
        .catch((error) => {
          console.error('Error loading purchase order:', error);
          toast({
            title: 'Error',
            description: 'Failed to load purchase order',
            variant: 'destructive',
          });
        })
        .finally(() => setLoading(false));
    }
  }, [isEditing, poId]);

  // Calculate totals
  const total = useMemo(() => {
    return lines.reduce((sum, line) => sum + line.line_total, 0);
  }, [lines]);

  const budgetValue = budget ? parseFloat(budget) : null;
  const budgetRemaining = budgetValue ? Math.max(0, budgetValue - total) : null;
  const budgetOverage = budgetValue && total > budgetValue ? total - budgetValue : null;
  const budgetProgress = budgetValue ? Math.min(100, (total / budgetValue) * 100) : 0;

  // Filter products by selected supplier and search
  const availableProducts = useMemo(() => {
    if (!supplierId) return [];

    let filtered = products.filter((p) => {
      // Filter by supplier
      const hasSupplier = p.supplier_id === supplierId;
      if (!hasSupplier) return false;

      // Filter by search term
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        return (
          p.name.toLowerCase().includes(term) ||
          (p.sku?.toLowerCase() ?? '').includes(term) ||
          (p.category?.toLowerCase() ?? '').includes(term)
        );
      }

      return true;
    });

    // Filter by category
    if (selectedCategory && selectedCategory !== 'all') {
      filtered = filtered.filter((p) => p.category === selectedCategory);
    }

    return filtered;
  }, [products, supplierId, searchTerm, selectedCategory]);

  // Get unique categories
  const categories = useMemo(() => {
    const cats = new Set(
      products.filter((p) => p.supplier_id === supplierId && p.category).map((p) => p.category!)
    );
    return Array.from(cats).sort();
  }, [products, supplierId]);

  // Handle supplier change
  const handleSupplierChange = (newSupplierId: string) => {
    if (lines.length > 0 && supplierId !== newSupplierId) {
      setPendingSupplierId(newSupplierId);
      setChangeSupplierDialog(true);
    } else {
      setSupplierId(newSupplierId);
    }
  };

  const confirmSupplierChange = () => {
    setSupplierId(pendingSupplierId);
    setLines([]);
    setChangeSupplierDialog(false);
  };

  // Add item to PO
  const handleAddItem = async (product: Product) => {
    if (!supplierId || !restaurantId) return;

    // Check if item already exists
    const existingLine = lines.find((line) => line.product_id === product.id);
    if (existingLine) {
      toast({
        title: 'Item already added',
        description: 'This item is already in the purchase order',
      });
      return;
    }

    const newLine: Partial<PurchaseOrderLine> = {
      product_id: product.id,
      supplier_id: supplierId,
      item_name: product.name,
      sku: product.sku,
      unit_label: product.uom_purchase || 'Unit',
      unit_cost: product.cost_per_unit || 0,
      quantity: 1,
      line_total: product.cost_per_unit || 0,
    };

    if (isEditing && po) {
      // Add to database
      const lineData: CreatePurchaseOrderLineData = {
        purchase_order_id: po.id,
        product_id: product.id,
        supplier_id: supplierId,
        item_name: product.name,
        sku: product.sku,
        unit_label: product.uom_purchase || 'Unit',
        unit_cost: product.cost_per_unit || 0,
        quantity: 1,
      };

      try {
        const addedLine = await addLineItem(lineData);
        setLines([...lines, addedLine]);
      } catch (error) {
        console.error('Error adding line:', error);
      }
    } else {
      // Add to local state (for new PO)
      const tempLine: PurchaseOrderLine = {
        id: `temp-${Date.now()}`,
        purchase_order_id: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        received_quantity: 0,
        notes: null,
        ...newLine,
      } as PurchaseOrderLine;
      setLines([...lines, tempLine]);
    }
  };

  // Update line item
  const handleUpdateLine = async (lineId: string, field: 'quantity' | 'unit_cost', value: number) => {
    const updatedLines = lines.map((line) => {
      if (line.id === lineId) {
        const newLine = { ...line };
        if (field === 'quantity') {
          newLine.quantity = value;
        } else {
          newLine.unit_cost = value;
        }
        newLine.line_total = newLine.quantity * newLine.unit_cost;
        return newLine;
      }
      return line;
    });

    setLines(updatedLines);

    if (isEditing && po && !lineId.startsWith('temp-')) {
      try {
        await updateLineItem(lineId, { [field]: value });
      } catch (error) {
        console.error('Error updating line:', error);
      }
    }
  };

  // Remove line item
  const handleRemoveLine = async (lineId: string) => {
    setLines(lines.filter((line) => line.id !== lineId));

    if (isEditing && po && !lineId.startsWith('temp-')) {
      try {
        await deleteLineItem(lineId);
      } catch (error) {
        console.error('Error removing line:', error);
      }
    }
  };

  // Save PO
  const handleSave = async (status: 'DRAFT' | 'READY_TO_SEND') => {
    if (!restaurantId || !supplierId) {
      toast({
        title: 'Validation Error',
        description: 'Please select a supplier',
        variant: 'destructive',
      });
      return;
    }

    if (status === 'READY_TO_SEND' && lines.length === 0) {
      toast({
        title: 'Validation Error',
        description: 'Please add at least one item to mark as ready to send',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);

    try {
      if (isNew) {
        // Create new PO
        const newPo = await createPurchaseOrder({
          restaurant_id: restaurantId,
          supplier_id: supplierId,
          budget: budgetValue,
          notes: notes || null,
          status,
        });

        // Add lines
        for (const line of lines) {
          await addLineItem({
            purchase_order_id: newPo.id,
            product_id: line.product_id,
            supplier_id: supplierId,
            item_name: line.item_name,
            sku: line.sku,
            unit_label: line.unit_label,
            unit_cost: line.unit_cost,
            quantity: line.quantity,
          });
        }

        toast({
          title: 'Success',
          description: 'Purchase order created successfully',
        });
        navigate(`/purchase-orders/${newPo.id}`);
      } else if (po) {
        // Update existing PO
        await updatePurchaseOrder(po.id, {
          supplier_id: supplierId,
          budget: budgetValue,
          notes: notes || null,
          status,
        });

        toast({
          title: 'Success',
          description: 'Purchase order updated successfully',
        });
      }
    } catch (error) {
      console.error('Error saving PO:', error);
      toast({
        title: 'Error',
        description: 'Failed to save purchase order',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  if (!selectedRestaurant) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Card className="w-96">
          <CardContent className="pt-6 text-center">
            <p className="text-muted-foreground">Please select a restaurant</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading && isEditing) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/purchase-orders')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div>
            <h1 className="text-3xl font-bold">{isNew ? 'New Purchase Order' : `Edit Purchase Order`}</h1>
            {po?.po_number && <p className="text-muted-foreground">{po.po_number}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => handleSave('DRAFT')} disabled={loading || !supplierId}>
            <Save className="h-4 w-4 mr-2" />
            Save Draft
          </Button>
          <Button onClick={() => handleSave('READY_TO_SEND')} disabled={loading || !supplierId || lines.length === 0}>
            <Send className="h-4 w-4 mr-2" />
            Mark as Ready to Send
          </Button>
        </div>
      </div>

      {/* Header Info Card */}
      <Card>
        <CardHeader>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Supplier Selector */}
            <div className="space-y-2">
              <Label htmlFor="supplier">Supplier *</Label>
              <Select value={supplierId} onValueChange={handleSupplierChange} disabled={suppliersLoading}>
                <SelectTrigger id="supplier">
                  <SelectValue placeholder="Select supplier" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((supplier) => (
                    <SelectItem key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Budget */}
            <div className="space-y-2">
              <Label htmlFor="budget">Target Budget (optional)</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input
                  id="budget"
                  type="number"
                  step="0.01"
                  min="0"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  className="pl-7"
                  placeholder="0.00"
                />
              </div>
            </div>

            {/* Order Summary */}
            <div className="space-y-2">
              <Label>Order Summary</Label>
              <div className="p-3 bg-muted rounded-md space-y-1">
                <div className="flex justify-between text-sm">
                  <span>Order Total:</span>
                  <span className="font-semibold">${total.toFixed(2)}</span>
                </div>
                {budgetValue && (
                  <>
                    {budgetRemaining !== null && budgetRemaining > 0 && (
                      <div className="flex justify-between text-sm text-green-600">
                        <span>Remaining:</span>
                        <span className="font-semibold">${budgetRemaining.toFixed(2)}</span>
                      </div>
                    )}
                    {budgetOverage !== null && budgetOverage > 0 && (
                      <div className="flex justify-between text-sm text-destructive">
                        <span>Over Budget:</span>
                        <span className="font-semibold">${budgetOverage.toFixed(2)}</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Budget Progress Bar */}
          {budgetValue && (
            <div className="mt-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span>Budget Usage</span>
                <span className={cn(budgetProgress > 100 ? 'text-destructive' : 'text-muted-foreground')}>
                  {budgetProgress.toFixed(0)}%
                </span>
              </div>
              <Progress
                value={budgetProgress}
                className={cn(budgetProgress > 100 && '[&>div]:bg-destructive')}
              />
            </div>
          )}
        </CardHeader>
      </Card>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Items Table */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Order Items</CardTitle>
              <CardDescription>
                {lines.length} {lines.length === 1 ? 'item' : 'items'} · Total: ${total.toFixed(2)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!supplierId ? (
                <div className="text-center py-12">
                  <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">Select a supplier to start building your order</p>
                </div>
              ) : lines.length === 0 ? (
                <div className="text-center py-12">
                  <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No items added yet</p>
                  <p className="text-sm text-muted-foreground">Search for products on the right to add items</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">#</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead className="w-32">Unit Cost</TableHead>
                      <TableHead className="w-32">Quantity</TableHead>
                      <TableHead className="text-right w-32">Line Total</TableHead>
                      <TableHead className="w-16"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((line, index) => (
                      <TableRow key={line.id}>
                        <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                        <TableCell>
                          <div>
                            <div className="font-medium">{line.item_name}</div>
                            {line.sku && <div className="text-sm text-muted-foreground">SKU: {line.sku}</div>}
                          </div>
                        </TableCell>
                        <TableCell>{line.unit_label}</TableCell>
                        <TableCell>
                          <div className="relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                              $
                            </span>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              value={line.unit_cost}
                              onChange={(e) => handleUpdateLine(line.id, 'unit_cost', parseFloat(e.target.value) || 0)}
                              className="pl-6 text-sm"
                              aria-label={`Unit cost for ${line.item_name}`}
                            />
                          </div>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={line.quantity}
                            onChange={(e) => handleUpdateLine(line.id, 'quantity', parseFloat(e.target.value) || 0)}
                            className="text-sm"
                            aria-label={`Quantity for ${line.item_name}`}
                          />
                        </TableCell>
                        <TableCell className="text-right font-medium">${line.line_total.toFixed(2)}</TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveLine(line.id)}
                            aria-label={`Remove ${line.item_name}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Notes */}
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any notes about this purchase order..."
                rows={3}
              />
            </CardContent>
          </Card>
        </div>

        {/* Right: Item Picker */}
        <div className="lg:col-span-1">
          <Card className="sticky top-6">
            <CardHeader>
              <CardTitle>Add Items</CardTitle>
              <CardDescription>Search and add products to the order</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="search" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="search">Search Inventory</TabsTrigger>
                  <TabsTrigger value="suggestions" disabled>
                    Smart Suggestions
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="search" className="space-y-4">
                  {!supplierId ? (
                    <p className="text-sm text-muted-foreground">Select a supplier first</p>
                  ) : (
                    <>
                      {/* Search */}
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Search items..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="pl-9"
                        />
                      </div>

                      {/* Category Filter */}
                      {categories.length > 0 && (
                        <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                          <SelectTrigger>
                            <SelectValue placeholder="All categories" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All categories</SelectItem>
                            {categories.map((cat) => (
                              <SelectItem key={cat} value={cat}>
                                {cat}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}

                      {/* Product List */}
                      <div className="space-y-2 max-h-[500px] overflow-y-auto">
                        {productsLoading ? (
                          <div className="space-y-2">
                            {[...Array(5)].map((_, i) => (
                              <Skeleton key={i} className="h-20 w-full" />
                            ))}
                          </div>
                        ) : availableProducts.length === 0 ? (
                          <div className="text-center py-8">
                            <Package className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                            <p className="text-sm text-muted-foreground">
                              {searchTerm ? 'No products found' : 'No products available for this supplier'}
                            </p>
                          </div>
                        ) : (
                          availableProducts.map((product) => {
                            const isAdded = lines.some((line) => line.product_id === product.id);
                            return (
                              <div
                                key={product.id}
                                className="p-3 border rounded-lg space-y-2 hover:bg-muted/50 transition-colors"
                              >
                                <div className="flex items-start justify-between">
                                  <div className="flex-1 min-w-0">
                                    <p className="font-medium truncate">{product.name}</p>
                                    {product.sku && (
                                      <p className="text-xs text-muted-foreground">SKU: {product.sku}</p>
                                    )}
                                    {product.category && (
                                      <Badge variant="outline" className="text-xs mt-1">
                                        {product.category}
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center justify-between">
                                  <div className="text-sm">
                                    <div className="text-muted-foreground">{product.uom_purchase || 'Unit'}</div>
                                    {product.cost_per_unit && (
                                      <div className="font-medium">${product.cost_per_unit.toFixed(2)}</div>
                                    )}
                                    {product.current_stock !== null && (
                                      <div className="text-xs text-muted-foreground">
                                        On hand: {product.current_stock}
                                      </div>
                                    )}
                                  </div>
                                  <Button
                                    size="sm"
                                    onClick={() => handleAddItem(product)}
                                    disabled={isAdded}
                                    aria-label={`Add ${product.name} to order`}
                                  >
                                    <Plus className="h-4 w-4 mr-1" />
                                    {isAdded ? 'Added' : 'Add'}
                                  </Button>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </>
                  )}
                </TabsContent>

                <TabsContent value="suggestions" className="space-y-4">
                  <div className="p-6 border rounded-lg bg-muted/30 text-center space-y-4">
                    <AlertCircle className="h-10 w-10 mx-auto text-muted-foreground" />
                    <div>
                      <p className="font-medium mb-2">AI-Powered Suggestions Coming Soon</p>
                      <p className="text-sm text-muted-foreground">
                        In the future, this tab will suggest an order based on your recent usage and budget.
                      </p>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Change Supplier Confirmation Dialog */}
      <AlertDialog open={changeSupplierDialog} onOpenChange={setChangeSupplierDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change Supplier?</AlertDialogTitle>
            <AlertDialogDescription>
              Changing the supplier will clear the current items. Do you want to continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSupplierChange}>Change Supplier & Clear Items</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default PurchaseOrderEditor;
