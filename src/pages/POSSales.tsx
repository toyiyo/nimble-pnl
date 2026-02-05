import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Plus, Search, Calendar, RefreshCw, Upload as UploadIcon, X, ArrowUpDown, Sparkles, Check, Split, Settings2, ExternalLink, AlertTriangle, ChefHat, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUnifiedSalesTotals } from "@/hooks/useUnifiedSalesTotals";
import { subDays, format as formatDateFn } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { SearchableAccountSelector } from "@/components/banking/SearchableAccountSelector";
import { EnhancedCategoryRulesDialog } from "@/components/banking/EnhancedCategoryRulesDialog";
import { useUnifiedSales } from "@/hooks/useUnifiedSales";
import { usePOSIntegrations } from "@/hooks/usePOSIntegrations";
import { useInventoryDeduction } from "@/hooks/useInventoryDeduction";
import { RestaurantSelector } from "@/components/RestaurantSelector";
import { POSSaleDialog } from "@/components/POSSaleDialog";
import { POSSalesFileUpload } from "@/components/POSSalesFileUpload";
import { POSSalesImportReview } from "@/components/POSSalesImportReview";
import { POSSalesDashboard } from "@/components/POSSalesDashboard";
import { POSSystemStatus } from "@/components/POSSystemStatus";
import { IntegrationLogo } from "@/components/IntegrationLogo";
import { format } from "date-fns";
import { InventoryDeductionDialog } from "@/components/InventoryDeductionDialog";
import { MapPOSItemDialog } from "@/components/MapPOSItemDialog";
import { UnifiedSaleItem } from "@/types/pos";
import { ExportDropdown } from "@/components/financial-statements/shared/ExportDropdown";
import { generateTablePDF } from "@/utils/pdfExport";
import Papa from "papaparse";
import { useToast } from "@/hooks/use-toast";
import { useCategorizePosSales } from "@/hooks/useCategorizePosSales";
import { useCategorizePosSale } from "@/hooks/useCategorizePosSale";
import { useSplitPosSale } from "@/hooks/useSplitPosSale";
import { SplitPosSaleDialog } from "@/components/pos-sales/SplitPosSaleDialog";
import { SplitSaleView } from "@/components/pos-sales/SplitSaleView";
import { SaleCard, RecipeInfo } from "@/components/pos-sales/SaleCard";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { useRecipes } from "@/hooks/useRecipes";
import { useNavigate } from "react-router-dom";
import { createRecipeByItemNameMap, hasRecipeMapping, getRecipeForItem } from "@/utils/recipeMapping";
import { useBulkSelection } from "@/hooks/useBulkSelection";
import { BulkActionBar } from "@/components/bulk-edit/BulkActionBar";
import { BulkCategorizePosSalesPanel } from "@/components/pos-sales/BulkCategorizePosSalesPanel";
import { useBulkCategorizePosSales } from "@/hooks/useBulkPosSaleActions";
import { isMultiSelectKey } from "@/utils/bulkEditUtils";
import { Checkbox } from "@/components/ui/checkbox";

export default function POSSales() {
  const {
    selectedRestaurant,
    setSelectedRestaurant,
    restaurants,
    loading: restaurantsLoading,
    createRestaurant,
    canCreateRestaurant,
  } = useRestaurantContext();
  const { hasAnyConnectedSystem, syncAllSystems, isSyncing, integrationStatuses } = usePOSIntegrations(
    selectedRestaurant?.restaurant_id || null,
  );
  const { simulateDeduction } = useInventoryDeduction();
  const { recipes } = useRecipes(selectedRestaurant?.restaurant_id || null);
  const navigate = useNavigate();

  const [searchTerm, setSearchTerm] = useState("");
  // Default to last 30 days for better UX and performance
  const [startDate, setStartDate] = useState(() => formatDateFn(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [endDate, setEndDate] = useState(() => formatDateFn(new Date(), "yyyy-MM-dd"));
  const [sortBy, setSortBy] = useState<'date' | 'name' | 'quantity' | 'amount'>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [recipeFilter, setRecipeFilter] = useState<'all' | 'with-recipe' | 'without-recipe'>('all');
  const [categorizationFilter, setCategorizationFilter] = useState<'all' | 'uncategorized' | 'pending-review' | 'categorized'>('all');
  const [showSaleDialog, setShowSaleDialog] = useState(false);
  const [editingSale, setEditingSale] = useState<{
    id: string;
    itemName: string;
    quantity: number;
    totalPrice?: number;
    unitPrice?: number;
    saleDate: string;
    saleTime?: string;
  } | null>(null);
  const [selectedView, setSelectedView] = useState<"sales" | "grouped">("sales");
  const [deductionDialogOpen, setDeductionDialogOpen] = useState(false);
  const [selectedItemForDeduction, setSelectedItemForDeduction] = useState<{ name: string; quantity: number } | null>(
    null,
  );
  const [importedSalesData, setImportedSalesData] = useState<ParsedSale[] | null>(null);
  const [activeTab, setActiveTab] = useState<"manual" | "import">("manual");
  const [mapPOSItemDialogOpen, setMapPOSItemDialogOpen] = useState(false);
  const [selectedPOSItemForMapping, setSelectedPOSItemForMapping] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [contextCueVisible, setContextCueVisible] = useState(false);
  const [cuePinned, setCuePinned] = useState(false);
  const [highlightToken, setHighlightToken] = useState(0);
  const { toast } = useToast();
  const {
    mutate: categorizePosSales,
    isPending: isCategorizingPending,
    error: categorizeError,
    reset: resetCategorizeError,
  } = useCategorizePosSales();
  const { mutate: categorizePosSale } = useCategorizePosSale(selectedRestaurant?.restaurant_id || null);
  const { mutate: splitPosSale } = useSplitPosSale();
  const { accounts } = useChartOfAccounts(selectedRestaurant?.restaurant_id || null);
  const [saleToSplit, setSaleToSplit] = useState<any>(null);
  const [editingCategoryForSale, setEditingCategoryForSale] = useState<string | null>(null);
  const [showRulesDialog, setShowRulesDialog] = useState(false);
  const [saleForRuleSuggestion, setSaleForRuleSuggestion] = useState<UnifiedSaleItem | null>(null);
  const [aiCategorizationError, setAiCategorizationError] = useState<string | null>(null);
  const [showBulkCategorizePanel, setShowBulkCategorizePanel] = useState(false);
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

  // Bulk selection hooks
  const bulkSelection = useBulkSelection();
  const bulkCategorize = useBulkCategorizePosSales();

  // Virtual list ref for performance - only renders visible items
  const salesListRef = useRef<HTMLDivElement>(null);

  const {
    sales,
    loading,
    loadingMore,
    hasMore,
    loadMoreSales,
    getSalesByDateRange,
    getSalesGroupedByItem,
    deleteManualSale,
  } = useUnifiedSales(selectedRestaurant?.restaurant_id || null, {
    searchTerm,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
  });

  // Server-side aggregated totals for dashboard metrics (independent of pagination)
  const { totals: serverTotals, isLoading: totalsLoading } = useUnifiedSalesTotals(
    selectedRestaurant?.restaurant_id || null,
    {
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      searchTerm: searchTerm || undefined,
    }
  );

  // Filter revenue and liability accounts for categorization (matching split dialog)
  const categoryAccounts = useMemo(() => {
    return accounts.filter(acc => acc.account_type === 'revenue' || acc.account_type === 'liability');
  }, [accounts]);

  // Create a map of POS item name to recipe for quick lookup
  // Uses utility function for testability - see tests/unit/recipeMapping.test.ts
  const recipeByItemName = useMemo(() => {
    return createRecipeByItemNameMap(recipes);
  }, [recipes]);

  // Pre-compute recipe info for each sale to avoid lookups during render
  // This is passed to SaleCard for optimal memoization
  const saleRecipeMap = useMemo(() => {
    const map = new Map<string, RecipeInfo | null>();
    for (const sale of sales) {
      const recipe = getRecipeForItem(sale.itemName, recipeByItemName);
      map.set(sale.id, recipe ? {
        id: recipe.id,
        name: recipe.name,
        hasIngredients: recipe.hasIngredients,
        profitMargin: recipe.profitMargin,
      } : null);
    }
    return map;
  }, [sales, recipeByItemName]);

  const handleMapPOSItem = useCallback((itemName: string) => {
    setSelectedPOSItemForMapping(itemName);
    setMapPOSItemDialogOpen(true);
  }, []);

  const handleMappingComplete = useCallback(async () => {
    // Refresh sales data to update unmapped items
    if (selectedRestaurant?.restaurant_id) {
      await syncAllSystems();
    }
  }, [selectedRestaurant?.restaurant_id, syncAllSystems]);

  const handleCheckboxChange = useCallback((id: string) => {
    bulkSelection.toggleItem(id);
    setLastSelectedId(id);
  }, [bulkSelection]);

  // Stable handlers for SaleCard - avoids re-renders
  const handleNavigateToRecipe = useCallback((recipeId: string) => {
    navigate(`/recipes?recipeId=${recipeId}`);
  }, [navigate]);

  const handleSetEditingCategory = useCallback((id: string | null) => {
    setEditingCategoryForSale(id);
  }, []);

  const handleCategorizePosSale = useCallback((params: {
    saleId: string;
    categoryId: string;
    accountInfo?: { account_name: string; account_code: string }
  }) => {
    categorizePosSale(params);
  }, [categorizePosSale]);

  const handleSplitSale = useCallback((sale: UnifiedSaleItem) => {
    setSaleToSplit(sale);
  }, []);

  const handleBulkCategorize = (categoryId: string, overrideExisting: boolean) => {
    if (!selectedRestaurant?.restaurant_id || bulkSelection.selectedCount === 0) return;
    
    bulkCategorize.mutate({
      saleIds: Array.from(bulkSelection.selectedIds),
      categoryId,
      restaurantId: selectedRestaurant.restaurant_id,
      overrideExisting,
    }, {
      onSuccess: () => {
        setShowBulkCategorizePanel(false);
        bulkSelection.exitSelectionMode();
      },
    });
  };

  // Exit selection mode when changing tabs
  useEffect(() => {
    bulkSelection.exitSelectionMode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  interface ParsedSale {
    itemName: string;
    quantity: number;
    totalPrice?: number;
    unitPrice?: number;
    saleDate: string;
    saleTime?: string;
    orderId?: string;
    rawData: Record<string, unknown>;
  }

  const handleRestaurantSelect = (restaurant: typeof selectedRestaurant) => {
    setSelectedRestaurant(restaurant);
  };

  // Auto-sync when restaurant is selected (only once)
  useEffect(() => {
    if (selectedRestaurant?.restaurant_id && hasAnyConnectedSystem()) {
      syncAllSystems();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRestaurant?.restaurant_id]); // Only re-run when restaurant changes

  const filteredSales = useMemo(() => {
    // Filter out child splits - only show parent sales or non-split sales
    let filtered = sales
      .filter((sale) => !sale.parent_sale_id) // Exclude child splits
      .filter((sale) => sale.itemName.toLowerCase().includes(searchTerm.toLowerCase()));
    
    if (startDate) {
      filtered = filtered.filter((sale) => sale.saleDate >= startDate);
    }
    
    if (endDate) {
      filtered = filtered.filter((sale) => sale.saleDate <= endDate);
    }
    
    // Apply recipe filter
    if (recipeFilter === 'with-recipe') {
      filtered = filtered.filter((sale) => hasRecipeMapping(sale.itemName, recipeByItemName));
    } else if (recipeFilter === 'without-recipe') {
      filtered = filtered.filter((sale) => !hasRecipeMapping(sale.itemName, recipeByItemName));
    }

    // Apply categorization filter
    if (categorizationFilter === 'uncategorized') {
      filtered = filtered.filter((sale) => !sale.is_categorized && !sale.suggested_category_id);
    } else if (categorizationFilter === 'pending-review') {
      filtered = filtered.filter((sale) => sale.suggested_category_id && !sale.is_categorized);
    } else if (categorizationFilter === 'categorized') {
      filtered = filtered.filter((sale) => sale.is_categorized);
    }

    // Apply sorting
    filtered.sort((a, b) => {
      let comparison = 0;
      
      switch (sortBy) {
        case 'date':
          comparison = a.saleDate.localeCompare(b.saleDate);
          if (comparison === 0 && a.saleTime && b.saleTime) {
            comparison = a.saleTime.localeCompare(b.saleTime);
          }
          break;
        case 'name':
          comparison = a.itemName.localeCompare(b.itemName);
          break;
        case 'quantity':
          comparison = a.quantity - b.quantity;
          break;
        case 'amount':
          comparison = (a.totalPrice || 0) - (b.totalPrice || 0);
          break;
      }
      
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    
    return filtered;
  }, [sales, searchTerm, startDate, endDate, recipeFilter, categorizationFilter, recipeByItemName, sortBy, sortDirection]);

  // Get sales with AI suggestions
  const suggestedSales = useMemo(() => {
    return sales.filter(sale => 
      sale.suggested_category_id && !sale.is_categorized
    );
  }, [sales]);

  // Count uncategorized sales
  const uncategorizedSalesCount = useMemo(() => {
    return sales.filter(sale => 
      !sale.is_categorized && !sale.suggested_category_id
    ).length;
  }, [sales]);

  const dateFilteredSales = filteredSales;

  // Bulk selection handlers - must be after dateFilteredSales is defined
  const handleSelectionToggle = useCallback((id: string, event: React.MouseEvent) => {
    const modifiers = isMultiSelectKey(event);

    if (modifiers.isRange && lastSelectedId) {
      bulkSelection.selectRange(dateFilteredSales, lastSelectedId, id);
    } else if (modifiers.isToggle) {
      bulkSelection.toggleItem(id);
    } else {
      bulkSelection.toggleItem(id);
    }

    // Always update lastSelectedId to support subsequent range selections
    setLastSelectedId(id);
  }, [lastSelectedId, bulkSelection, dateFilteredSales]);

  const handleCardClick = useCallback((id: string, event: React.MouseEvent) => {
    if (bulkSelection.isSelectionMode) {
      handleSelectionToggle(id, event);
    }
  }, [bulkSelection.isSelectionMode, handleSelectionToggle]);

  // Virtual list setup - only renders visible items for performance
  const salesVirtualizer = useVirtualizer({
    count: dateFilteredSales.length,
    getScrollElement: () => salesListRef.current,
    estimateSize: () => 100, // Approximate height, virtualizer handles variable heights
    overscan: 5, // Render 5 extra items above/below viewport for smooth scrolling
  });

  const handleSyncSales = async () => {
    if (selectedRestaurant?.restaurant_id) {
      await syncAllSystems();
    }
  };

  const groupedSales = useMemo(() => {
    // Group filtered sales by item name
    const byItem = new Map<string, { total_quantity: number; total_revenue: number; sale_count: number }>();
    for (const sale of filteredSales) {
      const existing = byItem.get(sale.itemName) ?? { total_quantity: 0, total_revenue: 0, sale_count: 0 };
      existing.total_quantity += sale.quantity;
      existing.total_revenue += sale.totalPrice ?? 0;
      existing.sale_count += 1;
      byItem.set(sale.itemName, existing);
    }
    
    return Array.from(byItem.entries()).map(([itemName, data]) => ({
      item_name: itemName,
      total_quantity: data.total_quantity,
      total_revenue: data.total_revenue,
      sale_count: data.sale_count,
    }));
  }, [filteredSales]);

  const handleSimulateDeduction = useCallback(async (itemName: string, quantity: number) => {
    if (!selectedRestaurant?.restaurant_id) return;

    setSelectedItemForDeduction({ name: itemName, quantity });
    setDeductionDialogOpen(true);
  }, [selectedRestaurant?.restaurant_id]);

  const handleFileProcessed = (data: ParsedSale[]) => {
    setImportedSalesData(data);
  };

  const handleImportComplete = async () => {
    setImportedSalesData(null);
    setActiveTab("manual");
    // Refresh sales data to show newly imported sales
    if (selectedRestaurant?.restaurant_id) {
      await syncAllSystems();
    }
  };

  const handleCancelImport = () => {
    setImportedSalesData(null);
  };

  const handleEditSale = useCallback((sale: UnifiedSaleItem) => {
    // If the sale is already split, open the split dialog for editing
    if (sale.is_split && sale.child_splits && sale.child_splits.length > 0) {
      setSaleToSplit(sale);
      return;
    }

    // Otherwise, open the regular sale dialog
    setEditingSale({
      id: sale.id,
      itemName: sale.itemName,
      quantity: sale.quantity,
      totalPrice: sale.totalPrice,
      unitPrice: sale.unitPrice,
      saleDate: sale.saleDate,
      saleTime: sale.saleTime,
    });
    setShowSaleDialog(true);
  }, []);

  const handleDeleteSale = useCallback(async (saleId: string) => {
    if (confirm("Are you sure you want to delete this manual sale?")) {
      await deleteManualSale(saleId);
    }
  }, [deleteManualSale]);

  const handleDialogClose = (open: boolean) => {
    setShowSaleDialog(open);
    if (!open) {
      setEditingSale(null);
    }
  };

  const handleSuggestRuleFromSale = useCallback((sale: UnifiedSaleItem) => {
    if (!sale.category_id) return;
    setSaleForRuleSuggestion(sale);
    setShowRulesDialog(true);
  }, []);

  const RULE_NAME_MAX_LENGTH = 30;

  const getPrefilledPOSRuleData = () => {
    if (!saleForRuleSuggestion || !saleForRuleSuggestion.category_id) return undefined;

    const itemName = saleForRuleSuggestion.itemName || '';
    
    return {
      ruleName: itemName 
        ? `Auto-categorize ${itemName.substring(0, RULE_NAME_MAX_LENGTH)}${itemName.length > RULE_NAME_MAX_LENGTH ? '...' : ''}`
        : 'POS sale categorization rule',
      appliesTo: 'pos_sales' as const,
      itemNamePattern: itemName || '',
      itemNameMatchType: 'contains' as const,
      posCategory: saleForRuleSuggestion.posCategory || '',
      categoryId: saleForRuleSuggestion.category_id,
      priority: '5',
      autoApply: true,
    };
  };

  const filtersSignature = useMemo(
    () =>
      JSON.stringify({
        startDate,
        endDate,
        searchTerm,
        recipeFilter,
        categorizationFilter,
        selectedView,
        sortBy,
        sortDirection,
      }),
    [startDate, endDate, searchTerm, recipeFilter, categorizationFilter, selectedView, sortBy, sortDirection],
  );

  const filterSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    if (!filtersSignature) return;
    if (filterSignatureRef.current === null) {
      filterSignatureRef.current = filtersSignature;
      return;
    }
    if (filterSignatureRef.current !== filtersSignature) {
      filterSignatureRef.current = filtersSignature;
      setContextCueVisible(true);
      setHighlightToken((prev) => prev + 1);
    }
  }, [filtersSignature]);

  useEffect(() => {
    setContextCueVisible(true);
    const timeout = setTimeout(() => setContextCueVisible(false), 3000);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!contextCueVisible || cuePinned) return;
    const timeout = setTimeout(() => setContextCueVisible(false), 3500);
    return () => clearTimeout(timeout);
  }, [contextCueVisible, cuePinned]);

  useEffect(() => {
    if (categorizeError instanceof Error) {
      setAiCategorizationError(categorizeError.message);
    }
  }, [categorizeError]);

  const handleToggleCuePin = () => {
    setCuePinned((prev) => {
      const next = !prev;
      if (next) {
        setContextCueVisible(true);
      }
      return next;
    });
  };

  const formatShortDate = (value: string) => {
    if (!value) return "";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }
    return format(parsed, "MMM d");
  };

  const contextDescription = useMemo(() => {
    const countSuffix = serverTotals.totalCount > 0 ? ` (${serverTotals.totalCount.toLocaleString()} sales)` : '';
    
    if (startDate && endDate) {
      return `Totals for ${formatShortDate(startDate)} - ${formatShortDate(endDate)}${countSuffix}`;
    }
    if (startDate) {
      return `Totals since ${formatShortDate(startDate)}${countSuffix}`;
    }
    if (endDate) {
      return `Totals through ${formatShortDate(endDate)}${countSuffix}`;
    }
    if (searchTerm) {
      return `Matching "${searchTerm}"${countSuffix}`;
    }
    if (recipeFilter === "with-recipe") {
      return `Totals for mapped recipes${countSuffix}`;
    }
    if (recipeFilter === "without-recipe") {
      return `Totals for items without recipes${countSuffix}`;
    }
    if (selectedView === "grouped") {
      return `Totals by item grouping${countSuffix}`;
    }
    return `All sales${countSuffix}`;
  }, [startDate, endDate, searchTerm, recipeFilter, selectedView, serverTotals.totalCount]);

  const latestSyncTime = useMemo(() => {
    if (!integrationStatuses || integrationStatuses.length === 0) return undefined;
    return integrationStatuses.reduce<string | undefined>((latest, status) => {
      if (!status.lastSyncAt) return latest;
      if (!latest) return status.lastSyncAt;
      return new Date(status.lastSyncAt) > new Date(latest) ? status.lastSyncAt : latest;
    }, undefined);
  }, [integrationStatuses]);

  const handleCategorizeClick = () => {
    if (!selectedRestaurant?.restaurant_id) return;
    setAiCategorizationError(null);
    resetCategorizeError();
    categorizePosSales(selectedRestaurant.restaurant_id);
  };

  const handleDismissAiError = () => {
    setAiCategorizationError(null);
    resetCategorizeError();
  };

  // Dashboard metrics from server-side aggregation (accurate regardless of pagination)
  // unmappedCount still needs client-side calculation as it depends on recipe mappings
  const unmappedCount = useMemo(() => {
    const uniqueItemNames = new Set(filteredSales.map(sale => sale.itemName));
    return Array.from(uniqueItemNames).filter(
      itemName => !hasRecipeMapping(itemName, recipeByItemName)
    ).length;
  }, [filteredSales, recipeByItemName]);

  const dashboardMetrics = useMemo(() => ({
    totalSales: serverTotals.totalCount,
    revenue: serverTotals.revenue,
    discounts: serverTotals.discounts,
    passThroughAmount: serverTotals.passThroughAmount,
    collectedAtPOS: serverTotals.collectedAtPOS,
    uniqueItems: serverTotals.uniqueItems,
    unmappedCount,
  }), [serverTotals, unmappedCount]);

  const activeFiltersCount = [
    searchTerm,
    startDate,
    endDate,
    recipeFilter !== 'all' ? 'recipe' : '',
    categorizationFilter !== 'all' ? 'categorization' : '',
    sortBy !== 'date' || sortDirection !== 'desc' ? 'sort' : ''
  ].filter(Boolean).length;

  const filtersActive = activeFiltersCount > 0 || selectedView === "grouped";

  const handleExportCSV = async () => {
    setIsExporting(true);
    try {
      const dataToExport = selectedView === "sales" ? filteredSales : groupedSales;
      
      let csvData;
      if (selectedView === "sales") {
        csvData = dataToExport.map((sale) => ({
          "Sale Date": sale.saleDate,
          "Sale Time": sale.saleTime || "",
          "Item Name": sale.itemName,
          "Quantity": sale.quantity,
          "Unit Price": sale.unitPrice ? `$${sale.unitPrice.toFixed(2)}` : "",
          "Total Price": sale.totalPrice ? `$${sale.totalPrice.toFixed(2)}` : "",
          "Source": sale.source || "",
        }));
      } else {
        csvData = dataToExport.map((item) => ({
          "Item Name": item.item_name,
          "Total Quantity Sold": item.total_quantity,
          "Total Revenue": `$${item.total_revenue.toFixed(2)}`,
          "Sales Count": item.sale_count,
          "Average Price": `$${(item.total_revenue / Math.max(1, item.total_quantity)).toFixed(2)}`,
        }));
      }

      const csv = Papa.unparse(csvData);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      
      const dateRange = startDate && endDate 
        ? `_${startDate}_to_${endDate}` 
        : startDate 
        ? `_from_${startDate}`
        : endDate 
        ? `_to_${endDate}`
        : "";
      
      link.setAttribute("href", url);
      link.setAttribute("download", `pos_sales_${selectedView}${dateRange}_${format(new Date(), "yyyyMMdd_HHmmss")}.csv`);
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({
        title: "Export Successful",
        description: "POS sales data exported to CSV",
      });
    } catch (error) {
      if (import.meta?.env?.DEV) console.error("Error exporting CSV:", error);
      toast({
        title: "Export Failed",
        description: "Failed to export POS sales data",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportPDF = async () => {
    setIsExporting(true);
    try {
      const dataToExport = selectedView === "sales" ? filteredSales : groupedSales;
      
      let tableData;
      let columns;
      
      if (selectedView === "sales") {
        columns = ["Date", "Time", "Item", "Qty", "Unit Price", "Total", "Source"];
        tableData = dataToExport.map((sale) => [
          sale.saleDate,
          sale.saleTime || "",
          sale.itemName,
          sale.quantity.toString(),
          sale.unitPrice ? `$${sale.unitPrice.toFixed(2)}` : "",
          sale.totalPrice ? `$${sale.totalPrice.toFixed(2)}` : "",
          sale.source || "",
        ]);
      } else {
        columns = ["Item Name", "Total Qty", "Sales Count", "Total Revenue", "Avg Price"];
        tableData = dataToExport.map((item) => [
          item.item_name,
          item.total_quantity.toString(),
          item.sale_count.toString(),
          `$${item.total_revenue.toFixed(2)}`,
          `$${(item.total_revenue / Math.max(1, item.total_quantity)).toFixed(2)}`,
        ]);
      }

      const dateRange = startDate && endDate 
        ? `${startDate} to ${endDate}` 
        : startDate 
        ? `From ${startDate}`
        : endDate 
        ? `To ${endDate}`
        : "All Time";

      const metrics = [
        { label: "Collected at POS", value: `$${dashboardMetrics.collectedAtPOS.toFixed(2)}` },
        { label: "Revenue", value: `$${dashboardMetrics.revenue.toFixed(2)}` },
        { label: "Discounts", value: `$${dashboardMetrics.discounts.toFixed(2)}` },
        { label: "Pass-Through Items", value: `$${dashboardMetrics.passThroughAmount.toFixed(2)}` },
        { label: "Total Sales", value: dashboardMetrics.totalSales.toString() },
        { label: "Unique Items", value: dashboardMetrics.uniqueItems.toString() },
      ];

      generateTablePDF({
        title: `POS Sales Report - ${selectedView === "sales" ? "Individual Sales" : "Grouped by Item"}`,
        restaurantName: selectedRestaurant?.restaurant.name || "",
        dateRange,
        columns,
        rows: tableData,
        metrics,
        filename: `pos_sales_${selectedView}_${format(new Date(), "yyyyMMdd_HHmmss")}.pdf`,
      });

      toast({
        title: "Export Successful",
        description: "POS sales report exported to PDF",
      });
    } catch (error) {
      if (import.meta?.env?.DEV) console.error("Error exporting PDF:", error);
      toast({
        title: "Export Failed",
        description: "Failed to export POS sales report",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  if (!selectedRestaurant) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold mb-4">POS Sales</h1>
          <p className="text-muted-foreground mb-8">
            Select a restaurant to manage POS sales and inventory deductions.
          </p>
        </div>
        <RestaurantSelector
          selectedRestaurant={selectedRestaurant}
          onSelectRestaurant={handleRestaurantSelect}
          restaurants={restaurants}
          loading={restaurantsLoading}
          canCreateRestaurant={canCreateRestaurant}
            createRestaurant={createRestaurant}
        />
      </div>
    );
  }

  return (
    <div className="space-y-8 md:space-y-10 max-w-[1400px] mx-auto">
      {/* Apple/Notion-inspired Header */}
      <header className="space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-[2rem] md:text-[2.5rem] font-semibold tracking-tight text-foreground">
                Sales
              </h1>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-muted text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                {selectedRestaurant.restaurant.name}
              </span>
            </div>
            <p className="text-[15px] text-muted-foreground">
              Track and categorize sales from all your POS systems
            </p>
          </div>

          {/* Action buttons - Apple style */}
          <div className="flex items-center gap-2">
            {hasAnyConnectedSystem() && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSyncSales}
                disabled={isSyncing}
                className="h-8 px-3 text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/80 rounded-lg transition-colors"
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isSyncing ? "animate-spin" : ""}`} />
                {isSyncing ? "Syncing" : "Sync"}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowRulesDialog(true)}
              className="h-8 px-3 text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/80 rounded-lg transition-colors"
            >
              <Settings2 className="h-3.5 w-3.5 mr-1.5" />
              Rules
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setActiveTab("import")}
              className="h-8 px-3 text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/80 rounded-lg transition-colors"
            >
              <UploadIcon className="h-3.5 w-3.5 mr-1.5" />
              Import
            </Button>
            <ExportDropdown
              onExportCSV={handleExportCSV}
              onExportPDF={handleExportPDF}
              isExporting={isExporting}
            />
            <div className="w-px h-5 bg-border mx-1" />
            <Button
              onClick={() => {
                setActiveTab("manual");
                setEditingSale(null);
                setShowSaleDialog(true);
              }}
              size="sm"
              className="h-8 px-3 text-[13px] font-medium bg-foreground text-background hover:bg-foreground/90 rounded-lg transition-colors shadow-sm"
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add Sale
            </Button>
          </div>
        </div>
      </header>

      {/* Dashboard Metrics */}
      <POSSalesDashboard
        totalSales={dashboardMetrics.totalSales}
        totalRevenue={dashboardMetrics.revenue}
        discounts={dashboardMetrics.discounts}
        passThroughAmount={dashboardMetrics.passThroughAmount}
        collectedAtPOS={dashboardMetrics.collectedAtPOS}
        uniqueItems={dashboardMetrics.uniqueItems}
        unmappedCount={dashboardMetrics.unmappedCount}
        lastSyncTime={latestSyncTime}
        contextCueVisible={contextCueVisible}
        cuePinned={cuePinned}
        onToggleCuePin={handleToggleCuePin}
        contextDescription={contextDescription}
        highlightToken={highlightToken}
        filtersActive={filtersActive}
        isLoading={totalsLoading}
      />

      {/* AI Categorization Section */}
      <Card className="border-border/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                AI Categorization
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Automatically categorize POS sales to chart of accounts
              </p>
            </div>
            <Button 
              onClick={handleCategorizeClick}
              disabled={isCategorizingPending || uncategorizedSalesCount === 0}
              className="gap-2"
            >
              <Sparkles className="h-4 w-4" />
              {isCategorizingPending ? "Categorizing..." : "AI Categorize Sales"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 text-sm">
            <Badge variant="secondary" className="gap-1">
              {uncategorizedSalesCount} uncategorized
            </Badge>
            {suggestedSales.length > 0 && (
              <Badge variant="default" className="gap-1 bg-gradient-to-r from-blue-500 to-purple-500">
                <Sparkles className="h-3 w-3" />
                {suggestedSales.length} pending review
              </Badge>
            )}
          </div>
        {aiCategorizationError && (
          <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <div className="flex items-start gap-3 text-destructive">
              <AlertTriangle className="h-5 w-5 flex-shrink-0" />
              <div className="space-y-2">
                <div className="font-semibold">AI categorization isn&apos;t available yet</div>
                <p className="text-destructive/80">{aiCategorizationError}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="border-destructive/40 text-destructive hover:bg-destructive/10"
                    onClick={() => navigate("/chart-of-accounts")}
                  >
                    Go to Accounting
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={handleDismissAiError}>
                    Dismiss
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "manual" | "import")} className="w-full">
        {/* Apple/Notion-style minimal tab bar */}
        <div className="flex items-center justify-between border-b border-border/40 mb-6">
          <TabsList className="h-auto p-0 bg-transparent border-0 gap-0">
            <TabsTrigger
              value="manual"
              className="relative px-0 py-3 mr-6 text-[14px] font-medium text-muted-foreground data-[state=active]:text-foreground data-[state=active]:shadow-none bg-transparent border-0 rounded-none after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-foreground after:scale-x-0 data-[state=active]:after:scale-x-100 after:transition-transform"
            >
              View Sales
            </TabsTrigger>
            <TabsTrigger
              value="import"
              className="relative px-0 py-3 text-[14px] font-medium text-muted-foreground data-[state=active]:text-foreground data-[state=active]:shadow-none bg-transparent border-0 rounded-none after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-foreground after:scale-x-0 data-[state=active]:after:scale-x-100 after:transition-transform"
            >
              Import from File
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="manual" className="space-y-6 mt-0">
          {/* Apple/Notion-style filter bar */}
          <div className="space-y-4">
            {/* Search and date row */}
            <div className="flex flex-col md:flex-row gap-3">
              {/* Search input - clean Apple style */}
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" aria-hidden="true" />
                <Input
                  placeholder="Search items..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  aria-label="Search items"
                  className="h-9 pl-9 text-[13px] bg-muted/40 border-0 rounded-lg focus-visible:ring-1 focus-visible:ring-border placeholder:text-muted-foreground/50"
                />
              </div>

              {/* Date range - compact */}
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    aria-label="Start date"
                    className="h-9 w-[150px] text-[13px] bg-muted/40 border-0 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                  />
                </div>
                <span className="text-muted-foreground/50 text-sm" aria-hidden="true">–</span>
                <div className="relative">
                  <Input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    aria-label="End date"
                    className="h-9 w-[150px] text-[13px] bg-muted/40 border-0 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                  />
                </div>
              </div>

              {/* Clear filters */}
              {activeFiltersCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchTerm("");
                    setStartDate("");
                    setEndDate("");
                    setRecipeFilter('all');
                    setCategorizationFilter('all');
                    setSortBy('date');
                    setSortDirection('desc');
                  }}
                  className="h-9 px-3 text-[13px] text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5 mr-1" />
                  Clear
                </Button>
              )}
            </div>

            {/* Filter pills row - Notion style segmented controls */}
            <div className="flex flex-wrap items-center gap-4">
              {/* Categorization filter - NEW FILTER */}
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Status</span>
                <div className="inline-flex rounded-lg bg-muted/50 p-0.5">
                  {[
                    { value: 'all', label: 'All' },
                    { value: 'uncategorized', label: 'Uncategorized', count: uncategorizedSalesCount },
                    { value: 'pending-review', label: 'Pending Review', count: suggestedSales.length },
                    { value: 'categorized', label: 'Categorized' },
                  ].map((option) => (
                    <button
                      key={option.value}
                      onClick={() => setCategorizationFilter(option.value as typeof categorizationFilter)}
                      className={`px-3 py-1.5 text-[13px] font-medium rounded-md transition-all ${
                        categorizationFilter === option.value
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {option.label}
                      {option.count !== undefined && option.count > 0 && (
                        <span className={`ml-1.5 text-[11px] ${
                          categorizationFilter === option.value ? 'text-muted-foreground' : 'text-muted-foreground/60'
                        }`}>
                          {option.count}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Divider */}
              <div className="h-5 w-px bg-border/60 hidden md:block" />

              {/* Recipe filter */}
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Recipe</span>
                <div className="inline-flex rounded-lg bg-muted/50 p-0.5">
                  {[
                    { value: 'all', label: 'All' },
                    { value: 'with-recipe', label: 'Mapped' },
                    { value: 'without-recipe', label: 'Unmapped' },
                  ].map((option) => (
                    <button
                      key={option.value}
                      onClick={() => setRecipeFilter(option.value as typeof recipeFilter)}
                      className={`px-3 py-1.5 text-[13px] font-medium rounded-md transition-all ${
                        recipeFilter === option.value
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Divider */}
              <div className="h-5 w-px bg-border/60 hidden md:block" />

              {/* View mode */}
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">View</span>
                <div className="inline-flex rounded-lg bg-muted/50 p-0.5">
                  <button
                    onClick={() => setSelectedView("sales")}
                    className={`px-3 py-1.5 text-[13px] font-medium rounded-md transition-all ${
                      selectedView === "sales"
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Individual
                  </button>
                  <button
                    onClick={() => setSelectedView("grouped")}
                    className={`px-3 py-1.5 text-[13px] font-medium rounded-md transition-all ${
                      selectedView === "grouped"
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Grouped
                  </button>
                </div>
              </div>

              {/* Sort controls */}
              <div className="flex items-center gap-2 ml-auto">
                <Select value={sortBy} onValueChange={(value: 'date' | 'name' | 'quantity' | 'amount') => setSortBy(value)}>
                  <SelectTrigger className="h-8 w-[120px] text-[13px] bg-transparent border-0 hover:bg-muted/50 rounded-lg">
                    <ArrowUpDown className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-50 bg-background">
                    <SelectItem value="date">Date</SelectItem>
                    <SelectItem value="name">Item Name</SelectItem>
                    <SelectItem value="quantity">Quantity</SelectItem>
                    <SelectItem value="amount">Amount</SelectItem>
                  </SelectContent>
                </Select>
                <button
                  onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
                  className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-muted/50 transition-colors"
                  title={sortDirection === 'desc' ? 'Descending' : 'Ascending'}
                  aria-label={sortDirection === 'desc' ? 'Descending order' : 'Ascending order'}
                >
                  <ArrowUpDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${sortDirection === 'desc' ? 'rotate-180' : ''}`} />
                </button>
              </div>
            </div>
          </div>

          {loading ? (
            /* Apple-style loading state */
            <div className="flex flex-col items-center justify-center py-20">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-foreground/70" />
              <p className="mt-4 text-[13px] text-muted-foreground">Loading sales...</p>
            </div>
          ) : selectedView === "sales" ? (
            <div className="space-y-4">
              {/* Results header bar */}
              <div className="flex items-center justify-between">
                <p className="text-[13px] text-muted-foreground">
                  {filteredSales.length === sales.length ? (
                    <>{sales.length.toLocaleString()} sales</>
                  ) : (
                    <>{filteredSales.length.toLocaleString()} of {sales.length.toLocaleString()} sales</>
                  )}
                </p>
                <div className="flex items-center gap-2">
                  {hasMore && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={loadMoreSales}
                      disabled={loadingMore}
                      className="h-8 px-3 text-[13px] font-medium text-muted-foreground hover:text-foreground"
                    >
                      {loadingMore ? "Loading..." : "Load more"}
                    </Button>
                  )}
                  {dateFilteredSales.length > 0 && (
                    <Button
                      variant={bulkSelection.isSelectionMode ? "default" : "ghost"}
                      size="sm"
                      onClick={bulkSelection.toggleSelectionMode}
                      className={`h-8 px-3 text-[13px] font-medium rounded-lg ${
                        bulkSelection.isSelectionMode
                          ? 'bg-foreground text-background'
                          : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                      }`}
                    >
                      {bulkSelection.isSelectionMode ? 'Done' : 'Select'}
                    </Button>
                  )}
                </div>
              </div>

              {/* Sales content */}
              {!hasAnyConnectedSystem() ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                    <AlertTriangle className="w-6 h-6 text-muted-foreground/50" />
                  </div>
                  <p className="text-[15px] font-medium text-foreground mb-1">No POS systems connected</p>
                  <p className="text-[13px] text-muted-foreground">Connect to Square, Toast, or record manual sales to get started.</p>
                </div>
              ) : dateFilteredSales.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                    <Search className="w-6 h-6 text-muted-foreground/50" />
                  </div>
                  <p className="text-[15px] font-medium text-foreground mb-1">No sales found</p>
                  <p className="text-[13px] text-muted-foreground">Try adjusting your filters or date range.</p>
                </div>
              ) : (
                <div className="space-y-0">
                  {/* Virtualized list container - Apple-style clean scrolling */}
                  <div
                    key={`virtualizer-${filtersSignature}`}
                    ref={salesListRef}
                    className="h-[600px] overflow-auto rounded-xl border border-border/40 bg-background"
                  >
                    <div
                      style={{
                        height: `${salesVirtualizer.getTotalSize()}px`,
                        width: '100%',
                        position: 'relative',
                      }}
                    >
                      {salesVirtualizer.getVirtualItems().map((virtualRow) => {
                        const sale = dateFilteredSales[virtualRow.index];
                        if (!sale) return null;

                        // If sale is split, show the SplitSaleView component
                        if (sale.is_split && sale.child_splits && sale.child_splits.length > 0) {
                          return (
                            <div
                              key={sale.id}
                              data-index={virtualRow.index}
                              ref={salesVirtualizer.measureElement}
                              style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                transform: `translateY(${virtualRow.start}px)`,
                              }}
                            >
                              <SplitSaleView
                                sale={sale}
                                onEdit={handleEditSale}
                                onSplit={(s) => setSaleToSplit(s)}
                                formatCurrency={(amount) => `$${amount.toFixed(2)}`}
                              />
                            </div>
                          );
                        }

                        // Regular sale card (non-split) - using extracted SaleCard component
                        return (
                          <div
                            key={sale.id}
                            data-index={virtualRow.index}
                            ref={salesVirtualizer.measureElement}
                            style={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              width: '100%',
                              transform: `translateY(${virtualRow.start}px)`,
                            }}
                          >
                            <SaleCard
                              sale={sale}
                              recipe={saleRecipeMap.get(sale.id) ?? null}
                              isSelected={bulkSelection.selectedIds.has(sale.id)}
                              isSelectionMode={bulkSelection.isSelectionMode}
                              isEditingCategory={editingCategoryForSale === sale.id}
                              accounts={accounts}
                              canEditManualSales={
                                !!selectedRestaurant &&
                                (selectedRestaurant.role === "owner" || selectedRestaurant.role === "manager")
                              }
                              onCardClick={handleCardClick}
                              onCheckboxChange={handleCheckboxChange}
                              onEdit={handleEditSale}
                              onDelete={handleDeleteSale}
                              onSimulateDeduction={handleSimulateDeduction}
                              onMapPOSItem={handleMapPOSItem}
                              onSetEditingCategory={handleSetEditingCategory}
                              onSplit={handleSplitSale}
                              onSuggestRule={handleSuggestRuleFromSale}
                              onCategorize={handleCategorizePosSale}
                              onNavigateToRecipe={handleNavigateToRecipe}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  {hasMore && (
                    <div className="flex justify-center py-4 border-t border-border/40">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={loadMoreSales}
                        disabled={loadingMore}
                        className="h-8 px-4 text-[13px] font-medium text-muted-foreground hover:text-foreground"
                      >
                        {loadingMore ? "Loading..." : "Load more sales"}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            /* Grouped view - Apple-style cards */
            <div className="space-y-4">
              {/* Results header */}
              <div className="flex items-center justify-between">
                <p className="text-[13px] text-muted-foreground">
                  {groupedSales.length.toLocaleString()} items
                </p>
                {hasMore && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={loadMoreSales}
                    disabled={loadingMore}
                    className="h-8 px-3 text-[13px] font-medium text-muted-foreground hover:text-foreground"
                  >
                    {loadingMore ? "Loading..." : "Load more"}
                  </Button>
                )}
              </div>

              {groupedSales.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                    <Search className="w-6 h-6 text-muted-foreground/50" />
                  </div>
                  <p className="text-[15px] font-medium text-foreground mb-1">No items found</p>
                  <p className="text-[13px] text-muted-foreground">Try adjusting your filters.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {groupedSales.map(
                    (item: {
                      item_name: string;
                      total_quantity: number;
                      sale_count: number;
                      total_revenue: number;
                    }) => {
                      const maxRevenue = Math.max(...groupedSales.map((g: { total_revenue: number }) => g.total_revenue));
                      const revenuePercentage = maxRevenue > 0 ? (item.total_revenue / maxRevenue) * 100 : 0;

                      return (
                        <div
                          key={item.item_name}
                          className="group p-4 rounded-xl border border-border/40 bg-background hover:border-border hover:shadow-sm transition-all"
                        >
                          <div className="flex items-start justify-between gap-3 mb-3">
                            <div className="flex-1 min-w-0">
                              <h3 className="text-[14px] font-medium text-foreground truncate">{item.item_name}</h3>
                              {(() => {
                                const recipe = getRecipeForItem(item.item_name, recipeByItemName);
                                if (recipe) {
                                  return (
                                    <button
                                      onClick={() => navigate(`/recipes?recipeId=${recipe.id}`)}
                                      className="inline-flex items-center gap-1 mt-1 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                      {!recipe.hasIngredients && (
                                        <AlertTriangle className="h-3 w-3 text-amber-500" />
                                      )}
                                      <ExternalLink className="h-3 w-3" />
                                      {recipe.name}
                                      {recipe.profitMargin != null && (
                                        <span className="font-medium">({recipe.profitMargin.toFixed(0)}%)</span>
                                      )}
                                    </button>
                                  );
                                }
                                return (
                                  <button
                                    onClick={() => handleMapPOSItem(item.item_name)}
                                    className="inline-flex items-center gap-1 mt-1 text-[12px] text-destructive hover:text-destructive/80 transition-colors"
                                  >
                                    No Recipe
                                  </button>
                                );
                              })()}
                            </div>
                            <span className="text-[18px] font-semibold text-foreground tabular-nums">
                              ${item.total_revenue.toFixed(2)}
                            </span>
                          </div>

                          {/* Revenue progress bar - subtle */}
                          <div className="mb-3">
                            <div className="h-1 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full bg-foreground/20 rounded-full transition-all duration-500"
                                style={{ width: `${revenuePercentage}%` }}
                              />
                            </div>
                          </div>

                          {/* Stats row */}
                          <div className="flex items-center gap-4 text-[13px]">
                            <div>
                              <span className="font-medium text-foreground">{item.total_quantity}</span>
                              <span className="text-muted-foreground ml-1">qty</span>
                            </div>
                            <div>
                              <span className="font-medium text-foreground">{item.sale_count}</span>
                              <span className="text-muted-foreground ml-1">sales</span>
                            </div>
                            <button
                              onClick={() => handleSimulateDeduction(item.item_name, item.total_quantity)}
                              className="ml-auto text-[12px] text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
                            >
                              Check impact
                            </button>
                          </div>
                        </div>
                      );
                    },
                  )}
                </div>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="import" className="space-y-6">
          {importedSalesData ? (
            <POSSalesImportReview
              salesData={importedSalesData}
              onImportComplete={handleImportComplete}
              onCancel={handleCancelImport}
            />
          ) : (
            <POSSalesFileUpload onFileProcessed={handleFileProcessed} />
          )}
        </TabsContent>
      </Tabs>

      <POSSaleDialog
        open={showSaleDialog}
        onOpenChange={handleDialogClose}
        restaurantId={selectedRestaurant.restaurant_id}
        editingSale={editingSale}
      />

      {/* Inventory Deduction Dialog */}
      {selectedItemForDeduction && (
        <InventoryDeductionDialog
          isOpen={deductionDialogOpen}
          onClose={() => {
            setDeductionDialogOpen(false);
            setSelectedItemForDeduction(null);
          }}
          restaurantId={selectedRestaurant.restaurant_id}
          posItemName={selectedItemForDeduction.name}
          quantitySold={selectedItemForDeduction.quantity}
        />
      )}

      {/* Map POS Item Dialog */}
      {selectedPOSItemForMapping && (
        <MapPOSItemDialog
          open={mapPOSItemDialogOpen}
          onOpenChange={setMapPOSItemDialogOpen}
          restaurantId={selectedRestaurant.restaurant_id}
          posItemName={selectedPOSItemForMapping}
          onMappingComplete={handleMappingComplete}
        />
      )}

      {/* Split POS Sale Dialog */}
      <SplitPosSaleDialog
        sale={saleToSplit}
        isOpen={!!saleToSplit}
        onClose={() => setSaleToSplit(null)}
        restaurantId={selectedRestaurant?.restaurant_id || ""}
      />

      {/* Categorization Rules Dialog */}
      <EnhancedCategoryRulesDialog
        open={showRulesDialog}
        onOpenChange={(open) => {
          setShowRulesDialog(open);
          if (!open) {
            setSaleForRuleSuggestion(null);
          }
        }}
        defaultTab="pos"
        prefilledRule={getPrefilledPOSRuleData()}
      />

      {/* Bulk action bar (appears when items are selected) */}
      {bulkSelection.hasSelection && (
        <BulkActionBar
          selectedCount={bulkSelection.selectedCount}
          onClose={bulkSelection.exitSelectionMode}
          actions={[
            {
              label: 'Categorize',
              icon: <Tags className="h-4 w-4" />,
              onClick: () => setShowBulkCategorizePanel(true),
            },
          ]}
        />
      )}

      {/* Bulk categorize panel */}
      <BulkCategorizePosSalesPanel
        isOpen={showBulkCategorizePanel}
        onClose={() => setShowBulkCategorizePanel(false)}
        selectedCount={bulkSelection.selectedCount}
        onApply={handleBulkCategorize}
        isApplying={bulkCategorize.isPending}
      />
    </div>
  );
}
