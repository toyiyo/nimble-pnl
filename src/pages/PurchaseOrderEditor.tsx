import React, { useState, useEffect, useMemo } from 'react';
import { usePostHog } from 'posthog-js/react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, Send, Plus, Trash2, Search, Package, Download, FileText, FileSpreadsheet, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';
import { usePurchaseOrders } from '@/hooks/usePurchaseOrders';
import { useSuppliers } from '@/hooks/useSuppliers';
import { useProducts, Product } from '@/hooks/useProducts';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useHighUsageItems } from '@/hooks/useHighUsageItems';
import {
  PurchaseOrderViewModel,
  PurchaseOrderLine,
  CreatePurchaseOrderLineData,
} from '@/types/purchaseOrder';
import { cn } from '@/lib/utils';
import { calculateRecommendation } from '@/lib/poRecommendations';
import {
  exportPurchaseOrderToPDF,
  exportPurchaseOrderToCSV,
  exportPurchaseOrderToText,
} from '@/utils/purchaseOrderExport';

const USAGE_SUGGESTION_LIMIT = 5;

export const PurchaseOrderEditor: React.FC = () => {
  const navigate = useNavigate();
  const { id: poId } = useParams<{ id: string }>();
  const posthog = usePostHog();
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
  const [suggestingOrder, setSuggestingOrder] = useState(false);
  const [suggestionSummary, setSuggestionSummary] = useState<{ applied: number; estimatedTotal: number } | null>(null);
  const [includeUsageSuggestions, setIncludeUsageSuggestions] = useState(false);
  const [activeAddItemsTab, setActiveAddItemsTab] = useState<'search' | 'suggestions'>('search');

  const usageInsightsEnabled = includeUsageSuggestions || activeAddItemsTab === 'suggestions';
  const {
    usageItems,
    loading: usageLoading,
    error: usageError,
  } = useHighUsageItems(restaurantId, { enabled: usageInsightsEnabled });

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
            safeSetLines(data.lines || []);
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

  const budgetValue = budget ? Number.parseFloat(budget) : null;
  const budgetRemaining = budgetValue != null ? Math.max(0, budgetValue - total) : null;
  const budgetOverage = budgetValue != null && total > budgetValue ? total - budgetValue : null;
  const budgetProgress = budgetValue != null && budgetValue !== 0 ? Math.min(100, (total / budgetValue) * 100) : 0;

  // Get supplier name by ID
  const getSupplierName = (supplierId: string) => {
    const supplier = suppliers.find((s) => s.id === supplierId);
    return supplier?.name || 'Unknown';
  };

  const productLookup = useMemo(() => {
    const map = new Map<string, Product>();
    products.forEach((product) => {
      map.set(product.id, product);
    });
    return map;
  }, [products]);

  type LineTemplate = {
    product_id: string;
    supplier_id?: string | null;
    item_name: string;
    sku?: string | null;
    unit_label?: string | null;
    unit_cost: number;
    quantity: number;
  };

  const buildLineTemplate = (product: Product, quantity: number): LineTemplate => ({
    product_id: product.id,
    supplier_id: product.supplier_id || supplierId || null,
    item_name: product.name,
    sku: product.sku,
    unit_label: product.uom_purchase || null,
    unit_cost: product.cost_per_unit || 0,
    quantity,
  });

  const createTempLineFromTemplate = (template: LineTemplate): PurchaseOrderLine => ({
    id: `temp-${Date.now()}-${template.product_id}-${Math.random().toString(36).slice(2, 6)}`,
    purchase_order_id: '',
    product_id: template.product_id,
    supplier_id: template.supplier_id ?? '',
    item_name: template.item_name,
    sku: template.sku ?? null,
    unit_label: template.unit_label ?? 'Unit',
    unit_cost: template.unit_cost,
    quantity: template.quantity,
    line_total: template.unit_cost * template.quantity,
    received_quantity: 0,
    notes: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const sanitizeLine = (line: PurchaseOrderLine): PurchaseOrderLine => ({
    ...line,
    item_name: line.item_name ?? '',
    sku: line.sku ?? null,
    unit_label: line.unit_label ?? 'Unit',
    supplier_id: line.supplier_id ?? '',
    quantity: typeof line.quantity === 'number' ? line.quantity : Number(line.quantity) || 0,
    unit_cost: typeof line.unit_cost === 'number' ? line.unit_cost : Number(line.unit_cost) || 0,
    line_total: typeof line.line_total === 'number' ? line.line_total : Number(line.line_total) || 0,
  });

  const sanitizeLines = (l: PurchaseOrderLine[]) => l.map(sanitizeLine);

  const safeSetLines = (newLines: PurchaseOrderLine[]) => {
    try {
      setLines(sanitizeLines(newLines));
    } catch (err) {
      console.error('Failed to set lines (sanitization error)', err, newLines);
      toast({ title: 'Error', description: 'Failed to update items', variant: 'destructive' });
    }
  };

  interface LineRecommendationContext {
    product: Product | null;
    recommendation: ReturnType<typeof calculateRecommendation> | null;
    onHand: number | null;
    parMin: number | null;
    parMax: number | null;
  }

  const lineRecommendations = useMemo<Record<string, LineRecommendationContext>>(() => {
    const map: Record<string, LineRecommendationContext> = {};

    const asNumber = (value?: number | null) =>
      typeof value === 'number' && !Number.isNaN(value) ? value : null;

    lines.forEach((line) => {
      const productDetails = line.product_id ? productLookup.get(line.product_id) ?? null : null;
      const onHand = asNumber(productDetails?.current_stock);
      const parMin = asNumber(productDetails?.par_level_min);
      const parMax = asNumber(productDetails?.par_level_max);

      const recommendation = productDetails
        ? calculateRecommendation({
            onHand,
            parLevelMin: parMin,
            parLevelMax: parMax,
            reorderPoint: productDetails?.reorder_point,
            defaultOrderQuantity: productDetails?.package_qty,
            minOrderMultiple: productDetails?.package_qty,
          })
        : null;

      map[line.id] = {
        product: productDetails,
        recommendation,
        onHand,
        parMin,
        parMax,
      };
    });

    return map;
  }, [lines, productLookup]);

  const hasRecommendations = useMemo(() => {
    return Object.values(lineRecommendations).some(
      (context) => context.recommendation && context.recommendation.recommendedQuantity > 0,
    );
  }, [lineRecommendations]);

  // Show the Suggest Order control enabled by default so users can try it even if there are no
  // immediate recommendations. The handler will show a friendly toast if nothing actionable exists.
  const canSuggestOrder = true;

  // Filter products by search term and category
  const availableProducts = useMemo(() => {
    let filtered = products;

    // Filter by search term
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter((p) =>
        p.name.toLowerCase().includes(term) ||
        (p.sku?.toLowerCase() ?? '').includes(term) ||
        (p.category?.toLowerCase() ?? '').includes(term)
      );
    }

    // Filter by category
    if (selectedCategory && selectedCategory !== 'all') {
      filtered = filtered.filter((p) => p.category === selectedCategory);
    }

    return filtered;
  }, [products, searchTerm, selectedCategory]);

  // Get unique categories from all products
  const categories = useMemo(() => {
    const cats = new Set<string>();
    products.forEach((p) => {
      const raw = p.category;
      if (raw === null || raw === undefined) return;
      const value = typeof raw === 'string' ? raw : String(raw);
      const trimmed = value.trim();
      if (trimmed) cats.add(trimmed);
    });
    return Array.from(cats).sort((a, b) => a.localeCompare(b));
  }, [products]);

  // Handle supplier change (simplified - no clearing of items)
  const handleSupplierChange = (newSupplierId: string) => {
    setSupplierId(newSupplierId);
  };

  // Add item to PO
  const handleAddItem = async (product: Product, quantity = 1): Promise<PurchaseOrderLine | null> => {
    if (!restaurantId) return;

    // Check if item already exists
    const existingLine = lines.find((line) => line.product_id === product.id);
    if (existingLine) {
      toast({
        title: 'Item already added',
        description: 'This item is already in the purchase order',
      });
      return;
    }

    const template = buildLineTemplate(product, quantity);

  if (isEditing && po) {
      // Add to database
      const lineData: CreatePurchaseOrderLineData = {
        purchase_order_id: po.id,
        ...template,
        supplier_id: template.supplier_id ?? '',
        unit_label: template.unit_label ?? 'Unit',
        sku: template.sku ?? null,
      };

      try {
  const addedLine = await addLineItem(lineData);
  safeSetLines([...lines, addedLine]);
  return addedLine;
      } catch (error) {
        console.error('Error adding line:', error);
      }
    } else {
      // Add to local state (for new PO)
      const tempLine = createTempLineFromTemplate(template);
  safeSetLines([...lines, tempLine]);
      return tempLine;
    }
    return null;
  };

  const getUsageCandidates = (currentLines: PurchaseOrderLine[]) => {
    if (!includeUsageSuggestions) return [];
    const existingProductIds = new Set(currentLines.map((line) => line.product_id).filter(Boolean));
    return usageItems
      .filter((item) => !existingProductIds.has(item.productId))
      .slice(0, USAGE_SUGGESTION_LIMIT);
  };

  const applyUsageSuggestions = async (
    currentLines: PurchaseOrderLine[],
  ): Promise<{ lines: PurchaseOrderLine[]; addedCount: number }> => {
    const candidates = getUsageCandidates(currentLines);
    if (candidates.length === 0) {
      return { lines: currentLines, addedCount: 0 };
    }

    let updatedLines = [...currentLines];
    let addedCount = 0;

    // Precompute valid additions to keep the loop simple
    const additions = candidates
      .map((candidate) => {
        const product = productLookup.get(candidate.productId);
        const quantity =
          candidate.suggestedQuantity > 0 ? candidate.suggestedQuantity : candidate.totalUsage;
        if (!product || !quantity || quantity <= 0) return null;
        return { product, quantity };
      })
      .filter(Boolean) as { product: Product; quantity: number }[];

    for (const addition of additions) {
      try {
        const created = await handleAddItem(addition.product, addition.quantity);
        if (created) {
          updatedLines = [...updatedLines, created];
          addedCount += 1;
        }
      } catch (error) {
        console.error('Error adding usage-based suggestion:', error);
      }
    }

    return { lines: updatedLines, addedCount };
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

  safeSetLines(updatedLines);

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
  safeSetLines(lines.filter((line) => line.id !== lineId));

    if (isEditing && po && !lineId.startsWith('temp-')) {
      try {
        await deleteLineItem(lineId);
      } catch (error) {
        console.error('Error removing line:', error);
      }
    }
  };

  const handleSuggestOrder = async () => {
    if (suggestingOrder) return;
    const prevLines = lines;

    const usageCandidates = includeUsageSuggestions ? getUsageCandidates(lines) : [];
    const usageCandidatesAvailable = usageCandidates.length > 0;
    const updates: { lineId: string; nextQuantity: number }[] = [];

    const updatedLines = lines.map((line) => {
      const lineContext = lineRecommendations[line.id];
      const recommendedQty = lineContext?.recommendation?.recommendedQuantity;
      const currentQty = line.quantity || 0;
      if (!recommendedQty || recommendedQty <= 0) return line;
      if (recommendedQty <= currentQty) return line;
      updates.push({ lineId: line.id, nextQuantity: recommendedQty });
      return {
        ...line,
        quantity: recommendedQty,
        line_total: recommendedQty * (line.unit_cost || 0),
      };
    });

    const sanitized = sanitizeLines(updatedLines);

    if (updates.length === 0 && !usageCandidatesAvailable) {
      toast({
        title: 'No suggestions available',
        description: 'Add items with par levels or enable high-usage suggestions to see recommendations.',
      });
      return;
    }

    setSuggestingOrder(true);
    safeSetLines(sanitized);

    try {
      if (updates.length > 0 && isEditing && po) {
        const persistenceUpdates = updates.filter((update) => !update.lineId.startsWith('temp-'));
        await Promise.all(
          persistenceUpdates.map((update) => updateLineItem(update.lineId, { quantity: update.nextQuantity })),
        );
      }

      let workingLines = sanitized;
      let addedCount = 0;

      if (usageCandidatesAvailable) {
        const usageResult = await applyUsageSuggestions(workingLines);
        workingLines = usageResult.lines;
        addedCount = usageResult.addedCount;
      }

      if (addedCount > 0 || updates.length > 0) {
        safeSetLines(workingLines);
      }

      const finalEstimatedTotal = workingLines.reduce((sum, line) => sum + (line.unit_cost || 0) * line.quantity, 0);
      const totalAdjustments = updates.length + addedCount;

      if (totalAdjustments > 0) {
        setSuggestionSummary({
          applied: totalAdjustments,
          estimatedTotal: finalEstimatedTotal,
        });
      }

      posthog?.capture('purchase_order_suggest_order', {
        restaurantId,
        updatedCount: updates.length,
        usageItemsAdded: addedCount,
        totalAdjustments,
        includeUsage: includeUsageSuggestions,
        budgetValue,
      });

      toast({
        title: 'Suggestions applied',
        description: `Applied suggestions to ${totalAdjustments} item${totalAdjustments === 1 ? '' : 's'}.`,
        action: (
          <ToastAction altText="Undo applied suggestions" onClick={() => safeSetLines(prevLines)}>
            Undo
          </ToastAction>
        ),
      });
    } catch (error) {
      console.error('Error applying suggestions:', error);
      toast({
        title: 'Suggestion failed',
        description: 'Unable to apply all recommended quantities. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSuggestingOrder(false);
    }
  };

  // Save PO
  const handleSave = async (status: 'DRAFT' | 'READY_TO_SEND') => {
    if (!restaurantId) {
      toast({
        title: 'Validation Error',
        description: 'Please select a restaurant',
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
          supplier_id: supplierId || null,
          budget: budgetValue,
          notes: notes || null,
          status,
        });

        // Add lines (using supplier_id from each line)
        for (const line of lines) {
          await addLineItem({
            purchase_order_id: newPo.id,
            product_id: line.product_id,
            supplier_id: line.supplier_id,
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
          supplier_id: supplierId || null,
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

  // Export handler
  const handleExport = (format: 'pdf' | 'csv' | 'text') => {
    if (!po || !selectedRestaurant) {
      toast({
        title: 'Cannot export',
        description: 'Please save the purchase order first',
        variant: 'destructive',
      });
      return;
    }

    // Build supplier names map
    const supplierNames: Record<string, string> = {};
    suppliers.forEach((supplier) => {
      supplierNames[supplier.id] = supplier.name;
    });

    const restaurantName = selectedRestaurant.restaurant?.name || 'Restaurant';

    try {
      switch (format) {
        case 'pdf':
          exportPurchaseOrderToPDF(po, restaurantName, supplierNames);
          toast({
            title: 'Export successful',
            description: 'Purchase order exported to PDF',
          });
          break;
        case 'csv':
          exportPurchaseOrderToCSV(po, supplierNames);
          toast({
            title: 'Export successful',
            description: 'Purchase order exported to CSV',
          });
          break;
        case 'text':
          exportPurchaseOrderToText(po, restaurantName, supplierNames);
          toast({
            title: 'Export successful',
            description: 'Purchase order exported to text file',
          });
          break;
      }
    } catch (error) {
      console.error('Error exporting:', error);
      toast({
        title: 'Export failed',
        description: 'Failed to export purchase order',
        variant: 'destructive',
      });
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
          {isEditing && po && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={!po || lines.length === 0}>
                  <Download className="h-4 w-4 mr-2" />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleExport('pdf')}>
                  <FileText className="h-4 w-4 mr-2" />
                  Export as PDF
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport('csv')}>
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  Export as CSV
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport('text')}>
                  <FileText className="h-4 w-4 mr-2" />
                  Export as Text
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button variant="outline" onClick={() => handleSave('DRAFT')} disabled={loading}>
            <Save className="h-4 w-4 mr-2" />
            Save Draft
          </Button>
          <Button onClick={() => handleSave('READY_TO_SEND')} disabled={loading || lines.length === 0}>
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
              <Label htmlFor="supplier">Primary Supplier (optional)</Label>
              <Select value={supplierId} onValueChange={handleSupplierChange} disabled={suppliersLoading}>
                <SelectTrigger id="supplier">
                  <SelectValue placeholder="No supplier selected" />
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
                {budgetValue != null && (
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
          {budgetValue != null && (
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

          <div className="mt-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Use your current inventory levels and par targets to pre-fill this purchase order automatically.
              </p>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Switch
                  id="usage-suggestions"
                  checked={includeUsageSuggestions}
                  onCheckedChange={setIncludeUsageSuggestions}
                  aria-label="Include high-usage items"
                />
                <Label htmlFor="usage-suggestions" className="text-sm text-muted-foreground cursor-pointer">
                  Include high-usage items
                </Label>
              </div>
            </div>
            <Button
              className="gap-2"
              aria-label="Suggest order based on inventory par levels and usage suggestions"
              onClick={handleSuggestOrder}
              disabled={suggestingOrder || !canSuggestOrder}
            >
              <Sparkles className="h-4 w-4" />
              {suggestingOrder ? 'Applying...' : 'Suggest Order'}
            </Button>
            {/* Helpful hint when there are no immediate par recommendations */}
            {!hasRecommendations && !includeUsageSuggestions && (
              <p className="text-xs text-muted-foreground mt-1">
                No automatic par recommendations available — toggle "Include high-usage items" or add
                items with par levels to get suggestions.
              </p>
            )}
          </div>

          {suggestionSummary && (
            <div className="mt-4 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm space-y-2">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-2 text-foreground">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <span>
                    Applied suggestions to {suggestionSummary.applied} item
                    {suggestionSummary.applied === 1 ? '' : 's'}.
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
                  <span>
                    Projected total:{' '}
                    <span className="font-semibold text-foreground">
                      ${suggestionSummary.estimatedTotal.toFixed(2)}
                    </span>
                  </span>
                  {budgetValue != null && (
                    <span
                      className={cn(
                        'font-medium',
                        suggestionSummary.estimatedTotal > budgetValue ? 'text-destructive' : 'text-foreground',
                      )}
                    >
                      {suggestionSummary.estimatedTotal > budgetValue
                        ? `Over by $${(suggestionSummary.estimatedTotal - budgetValue).toFixed(2)}`
                        : `Under by $${(budgetValue - suggestionSummary.estimatedTotal).toFixed(2)}`}
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground"
                    onClick={() => setSuggestionSummary(null)}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Suggestions Confirmation Dialog */}
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
              {lines.length === 0 ? (
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
                      <TableHead>Supplier</TableHead>
                      <TableHead className="w-28 text-center">On Hand</TableHead>
                      <TableHead className="w-36 text-center">Par / Min</TableHead>
                      <TableHead className="w-32 text-center">Recommended</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead className="w-44">Unit Cost</TableHead>
                      <TableHead className="w-32">Quantity</TableHead>
                      <TableHead className="text-right w-32">Line Total</TableHead>
                      <TableHead className="w-16"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((line, index) => {
                      const lineContext = lineRecommendations[line.id];
                      const onHand = lineContext?.onHand ?? null;
                      const parMin = lineContext?.parMin ?? null;
                      const parMax = lineContext?.parMax ?? null;
                      const recommendedQty = lineContext?.recommendation?.recommendedQuantity ?? null;
                      const hasParBounds = parMin !== null || parMax !== null;
                      const hasRecommendedQty = recommendedQty !== null;

                      return (
                        <TableRow key={line.id}>
                          <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                          <TableCell>
                            <div>
                              <div className="font-medium">{line.item_name}</div>
                              {line.sku && <div className="text-sm text-muted-foreground">SKU: {line.sku}</div>}
                            </div>
                          </TableCell>
                          <TableCell>
                            {line.supplier_id ? (
                              <Badge variant="outline" className="text-xs">
                                {getSupplierName(line.supplier_id)}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs text-muted-foreground">
                                No supplier
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            {onHand !== null ? (
                              <span className="font-medium">{onHand}</span>
                            ) : (
                              <span className="text-xs text-muted-foreground">N/A</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            {hasParBounds ? (
                              <div className="flex flex-col text-xs">
                                {parMax !== null && <span className="font-medium">{parMax}</span>}
                                {parMin !== null && (
                                  <span className="text-muted-foreground">
                                    Min {parMin}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">N/A</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            {hasRecommendedQty ? (
                              <span className="font-medium">{recommendedQty}</span>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>{line.unit_label}</TableCell>
                          <TableCell>
                            <div className="relative min-w-[140px]">
                              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                                $
                              </span>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                value={typeof line.unit_cost === 'number' && line.unit_cost > 0 ? line.unit_cost.toFixed(2) : ''}
                                placeholder="0.00"
                                onChange={(e) =>
                                  handleUpdateLine(line.id, 'unit_cost', Number.parseFloat(e.target.value) || 0)
                                }
                                className="pl-6 text-sm w-full min-w-[140px]"
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
                              onChange={(e) => handleUpdateLine(line.id, 'quantity', Number.parseFloat(e.target.value) || 0)}
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
                      );
                    })}
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
              <CardDescription>Search and add products from any supplier</CardDescription>
            </CardHeader>
            <CardContent>
                <Tabs
                  value={activeAddItemsTab}
                  onValueChange={(value) => setActiveAddItemsTab(value as 'search' | 'suggestions')}
                  className="w-full"
                >
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="search">Search Inventory</TabsTrigger>
                    <TabsTrigger value="suggestions">Smart Suggestions</TabsTrigger>
                  </TabsList>

                  <TabsContent value="search" className="space-y-4">
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
                        {new Array(5).fill(null).map((_, i) => (
                          <Skeleton key={`product-skel-${i}`} className="h-20 w-full" />
                        ))}
                      </div>
                    ) : availableProducts.length === 0 ? (
                      <div className="text-center py-8">
                        <Package className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                        <p className="text-sm text-muted-foreground">
                          {searchTerm ? 'No products found' : 'No products available'}
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
                                    <div className="flex gap-1 mt-1 flex-wrap">
                                      {product.supplier_id ? (
                                        <Badge variant="secondary" className="text-xs">
                                          {getSupplierName(product.supplier_id)}
                                        </Badge>
                                      ) : (
                                        <Badge variant="outline" className="text-xs text-muted-foreground">
                                          No supplier
                                        </Badge>
                                      )}
                                      {product.category && (
                                        <Badge variant="outline" className="text-xs">
                                          {product.category}
                                        </Badge>
                                      )}
                                    </div>
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
                  </TabsContent>

                  <TabsContent value="suggestions" className="space-y-4">
                    <div className="flex flex-col gap-1">
                      <p className="font-medium">High-usage items</p>
                      <p className="text-sm text-muted-foreground">
                        Ranked by usage over the past 14 days. Add them directly or let “Suggest Order” include them
                        automatically.
                      </p>
                    </div>
                    {usageLoading ? (
                      <div className="space-y-2">
                        {['s1', 's2', 's3', 's4'].map((key) => (
                          <Skeleton key={key} className="h-20 w-full" />
                        ))}
                      </div>
                    ) : usageError ? (
                      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                        {usageError}
                      </div>
                    ) : usageItems.length === 0 ? (
                      <div className="text-center py-10 text-sm text-muted-foreground">
                        <Package className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
                        No recent usage yet. Log inventory usage to unlock recommendations.
                      </div>
                    ) : (
                      usageItems.map((item) => {
                        const product = productLookup.get(item.productId) || null;
                        const isAdded = lines.some((line) => line.product_id === item.productId);
                        const onHand = typeof product?.current_stock === 'number' ? product.current_stock : null;
                        const suggestedQuantity = Math.max(1, Math.round(item.suggestedQuantity || 0));

                        return (
                          <div
                            key={item.productId}
                            className="p-3 border rounded-lg space-y-2 hover:bg-muted/50 transition-colors"
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1 space-y-1">
                                <p className="font-medium">{item.productName}</p>
                                {item.sku && (
                                  <p className="text-xs text-muted-foreground">SKU: {item.sku}</p>
                                )}
                                <p className="text-xs text-muted-foreground">
                                  Used {item.totalUsage} units in last 14 days · Suggest {suggestedQuantity}
                                </p>
                                {onHand !== null && (
                                  <p className="text-xs text-muted-foreground">On hand: {onHand}</p>
                                )}
                              </div>
                              <Button
                                size="sm"
                                onClick={() => product && handleAddItem(product, suggestedQuantity)}
                                disabled={isAdded || product == null}
                                aria-label={`Add ${item.productName} suggestion`}
                              >
                                <Plus className="h-4 w-4 mr-1" />
                                {isAdded ? 'Added' : 'Add'}
                              </Button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </TabsContent>
                </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>

    </div>
  );
};

export default PurchaseOrderEditor;
