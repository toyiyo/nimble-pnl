import React, { useState, useEffect, useMemo } from "react";
import { Plus, Search, Calendar, RefreshCw, Upload as UploadIcon, X, ArrowUpDown, Sparkles, Check, Split, Settings2, ExternalLink, AlertTriangle, ChefHat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { useRecipes } from "@/hooks/useRecipes";
import { useNavigate } from "react-router-dom";

export default function POSSales() {
  const {
    selectedRestaurant,
    setSelectedRestaurant,
    restaurants,
    loading: restaurantsLoading,
    createRestaurant,
  } = useRestaurantContext();
  const { sales, loading, getSalesByDateRange, getSalesGroupedByItem, unmappedItems, deleteManualSale, fetchUnifiedSales } =
    useUnifiedSales(selectedRestaurant?.restaurant_id || null);
  const { hasAnyConnectedSystem, syncAllSystems, isSyncing, integrationStatuses } = usePOSIntegrations(
    selectedRestaurant?.restaurant_id || null,
  );
  const { simulateDeduction } = useInventoryDeduction();
  const { recipes } = useRecipes(selectedRestaurant?.restaurant_id || null);
  const navigate = useNavigate();

  const [searchTerm, setSearchTerm] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [sortBy, setSortBy] = useState<'date' | 'name' | 'quantity' | 'amount'>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [recipeFilter, setRecipeFilter] = useState<'all' | 'with-recipe' | 'without-recipe'>('all');
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
  const { toast } = useToast();
  const { mutate: categorizePosSales, isPending: isCategorizingPending } = useCategorizePosSales();
  const { mutate: categorizePosSale } = useCategorizePosSale(selectedRestaurant?.restaurant_id || null);
  const { mutate: splitPosSale } = useSplitPosSale();
  const { accounts } = useChartOfAccounts(selectedRestaurant?.restaurant_id || null);
  const [saleToSplit, setSaleToSplit] = useState<any>(null);
  const [editingCategoryForSale, setEditingCategoryForSale] = useState<string | null>(null);
  const [showRulesDialog, setShowRulesDialog] = useState(false);
  const [saleForRuleSuggestion, setSaleForRuleSuggestion] = useState<UnifiedSaleItem | null>(null);

  // Filter revenue and liability accounts for categorization (matching split dialog)
  const categoryAccounts = useMemo(() => {
    return accounts.filter(acc => acc.account_type === 'revenue' || acc.account_type === 'liability');
  }, [accounts]);

  // Create a map of POS item name to recipe for quick lookup
  const recipeByItemName = useMemo(() => {
    const map = new Map<string, { 
      id: string; 
      name: string; 
      profitMargin?: number;
      hasIngredients: boolean;
    }>();
    recipes.forEach(recipe => {
      if (recipe.pos_item_name) {
        map.set(recipe.pos_item_name.toLowerCase(), {
          id: recipe.id,
          name: recipe.name,
          profitMargin: recipe.profit_margin,
          hasIngredients: recipe.ingredients ? recipe.ingredients.length > 0 : false
        });
      }
    });
    return map;
  }, [recipes]);

  const handleMapPOSItem = (itemName: string) => {
    setSelectedPOSItemForMapping(itemName);
    setMapPOSItemDialogOpen(true);
  };

  const handleMappingComplete = async () => {
    // Refresh sales data to update unmapped items
    if (selectedRestaurant?.restaurant_id) {
      await syncAllSystems();
    }
  };

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
      filtered = filtered.filter((sale) => recipeByItemName.has(sale.itemName.toLowerCase()));
    } else if (recipeFilter === 'without-recipe') {
      filtered = filtered.filter((sale) => !recipeByItemName.has(sale.itemName.toLowerCase()));
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
  }, [sales, searchTerm, startDate, endDate, recipeFilter, recipeByItemName, sortBy, sortDirection]);

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

  const handleSimulateDeduction = async (itemName: string, quantity: number) => {
    if (!selectedRestaurant?.restaurant_id) return;

    setSelectedItemForDeduction({ name: itemName, quantity });
    setDeductionDialogOpen(true);
  };

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

  const handleEditSale = (sale: UnifiedSaleItem) => {
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
  };

  const handleDeleteSale = async (saleId: string) => {
    if (confirm("Are you sure you want to delete this manual sale?")) {
      await deleteManualSale(saleId);
    }
  };

  const handleDialogClose = (open: boolean) => {
    setShowSaleDialog(open);
    if (!open) {
      setEditingSale(null);
    }
  };

  const handleSuggestRuleFromSale = (sale: UnifiedSaleItem) => {
    if (!sale.category_id) return;
    setSaleForRuleSuggestion(sale);
    setShowRulesDialog(true);
  };

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

  // Calculate dashboard metrics - MUST be before conditional return to follow Rules of Hooks
  const dashboardMetrics = useMemo(() => {
    const totalSales = filteredSales.length;
    
    // Separate revenue items from discounts and pass-through items based on adjustment_type
    let revenue = 0;
    let discounts = 0;
    let passThroughAmount = 0;
    
    filteredSales.forEach(sale => {
      // Calculate total for this sale (including child splits if applicable)
      let saleTotal = 0;
      
      if (sale.is_split && sale.child_splits && sale.child_splits.length > 0) {
        // Sum child split amounts for split sales
        saleTotal = sale.child_splits.reduce((childSum, split) => 
          childSum + (split.totalPrice || 0), 0
        );
      } else {
        // Use parent sale amount for non-split sales
        saleTotal = sale.totalPrice || 0;
      }
      
      // Categorize based on adjustment_type
      if (sale.adjustment_type === 'discount') {
        // Discounts are negative and shown separately
        discounts += saleTotal;
      } else if (sale.adjustment_type) {
        // Other adjustment types are pass-through (tax, tip, service_charge, fee)
        passThroughAmount += saleTotal;
      } else {
        // Items without adjustment_type are revenue
        revenue += saleTotal;
      }
    });
    
    const collectedAtPOS = revenue + passThroughAmount + discounts;
    const uniqueItems = new Set(filteredSales.map(sale => sale.itemName)).size;
    
    return {
      totalSales,
      revenue,
      discounts,
      passThroughAmount,
      collectedAtPOS,
      uniqueItems,
      unmappedCount: unmappedItems.length,
    };
  }, [filteredSales, unmappedItems]);

  const activeFiltersCount = [
    searchTerm, 
    startDate, 
    endDate,
    recipeFilter !== 'all' ? 'recipe' : '',
    sortBy !== 'date' || sortDirection !== 'desc' ? 'sort' : ''
  ].filter(Boolean).length;

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
          createRestaurant={createRestaurant}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 md:space-y-8">
      {/* Hero Section with Gradient */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-500/10 via-purple-500/10 to-pink-500/10 p-6 md:p-8 animate-fade-in">
        <div className="relative z-10">
          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
            <div className="space-y-2">
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight">POS Sales</h1>
              <p className="text-base md:text-lg text-muted-foreground">
                Unified sales data from all connected POS systems
              </p>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-background/50 backdrop-blur-sm border">
                <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-sm font-medium">{selectedRestaurant.restaurant.name}</span>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                variant="outline"
                onClick={() => setShowRulesDialog(true)}
                className="flex items-center gap-2 hover:bg-background/80 transition-all duration-300"
              >
                <Settings2 className="h-4 w-4" />
                <span className="hidden sm:inline">Categorization Rules</span>
                <span className="sm:hidden">Rules</span>
              </Button>
              <Button
                onClick={() => {
                  setActiveTab("manual");
                  setEditingSale(null);
                  setShowSaleDialog(true);
                }}
                className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 transition-all duration-300"
              >
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Record Manual Sale</span>
                <span className="sm:hidden">Manual Sale</span>
              </Button>
              <Button
                variant="outline"
                onClick={() => setActiveTab("import")}
                className="flex items-center gap-2 hover:bg-background/80 transition-all duration-300"
              >
                <UploadIcon className="h-4 w-4" />
                <span className="hidden sm:inline">Upload File</span>
                <span className="sm:hidden">Upload</span>
              </Button>
              {hasAnyConnectedSystem() && (
                <Button
                  variant="outline"
                  onClick={handleSyncSales}
                  disabled={isSyncing}
                  className="flex items-center gap-2 hover:bg-background/80 transition-all duration-300"
                >
                  <RefreshCw className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`} />
                  {isSyncing ? "Syncing..." : "Sync Sales"}
                </Button>
              )}
              <ExportDropdown
                onExportCSV={handleExportCSV}
                onExportPDF={handleExportPDF}
                isExporting={isExporting}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Dashboard Metrics */}
      <POSSalesDashboard
        totalSales={dashboardMetrics.totalSales}
        totalRevenue={dashboardMetrics.revenue}
        discounts={dashboardMetrics.discounts}
        passThroughAmount={dashboardMetrics.passThroughAmount}
        collectedAtPOS={dashboardMetrics.collectedAtPOS}
        uniqueItems={dashboardMetrics.uniqueItems}
        unmappedCount={dashboardMetrics.unmappedCount}
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
              onClick={() => categorizePosSales(selectedRestaurant.restaurant_id)}
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
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "manual" | "import")} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="manual">View Sales</TabsTrigger>
          <TabsTrigger value="import">Import from File</TabsTrigger>
        </TabsList>

        <TabsContent value="manual" className="space-y-6">
          <div className="grid gap-4 md:gap-6">
            <Card className="border-none shadow-md">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg md:text-xl">Filters & Search</CardTitle>
                  {activeFiltersCount > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                      setSearchTerm("");
                      setStartDate("");
                      setEndDate("");
                      setRecipeFilter('all');
                      setSortBy('date');
                      setSortDirection('desc');
                    }}
                    className="text-xs"
                  >
                    <X className="h-3 w-3 mr-1" />
                    Clear {activeFiltersCount} filter{activeFiltersCount !== 1 ? 's' : ''}
                  </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Search Items</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by item name..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10 transition-all duration-200 focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Start Date</label>
                    <div className="relative">
                      <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="pl-10 transition-all duration-200 focus:ring-2 focus:ring-primary/20"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">End Date</label>
                    <div className="relative">
                      <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="pl-10 transition-all duration-200 focus:ring-2 focus:ring-primary/20"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Recipe Filter</label>
                  <Select value={recipeFilter} onValueChange={(value: 'all' | 'with-recipe' | 'without-recipe') => setRecipeFilter(value)}>
                    <SelectTrigger className="border-border/50 hover:border-primary/50 transition-colors">
                      <ChefHat className="w-4 h-4 mr-2" />
                      <SelectValue placeholder="Filter by recipe..." />
                    </SelectTrigger>
                    <SelectContent className="z-50 bg-background">
                      <SelectItem value="all">All Items</SelectItem>
                      <SelectItem value="with-recipe">With Recipe</SelectItem>
                      <SelectItem value="without-recipe">Without Recipe</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Sort By</label>
                  <div className="flex gap-2">
                    <Select value={sortBy} onValueChange={(value: 'date' | 'name' | 'quantity' | 'amount') => setSortBy(value)}>
                      <SelectTrigger className="w-[160px] border-border/50 hover:border-primary/50 transition-colors">
                        <ArrowUpDown className="w-4 h-4 mr-2" />
                        <SelectValue placeholder="Sort by..." />
                      </SelectTrigger>
                      <SelectContent className="z-50 bg-background">
                        <SelectItem value="date">Date</SelectItem>
                        <SelectItem value="name">Item Name</SelectItem>
                        <SelectItem value="quantity">Quantity</SelectItem>
                        <SelectItem value="amount">Amount</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
                      className="transition-all hover:scale-105 duration-200"
                      title={sortDirection === 'desc' ? 'Descending order' : 'Ascending order'}
                      aria-label={sortDirection === 'desc' ? 'Descending order' : 'Ascending order'}
                    >
                      <ArrowUpDown className={`w-4 h-4 transition-transform ${sortDirection === 'desc' ? 'rotate-180' : ''}`} />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">View Mode</label>
                  <div className="inline-flex rounded-lg border p-1 bg-muted/50">
                    <Button
                      variant={selectedView === "sales" ? "default" : "ghost"}
                      onClick={() => setSelectedView("sales")}
                      size="sm"
                      className={`rounded-md transition-all duration-200 ${
                        selectedView === "sales" 
                          ? "bg-gradient-to-r from-blue-600 to-cyan-600 text-white shadow-sm" 
                          : "hover:bg-background/80"
                      }`}
                    >
                      Individual Sales
                    </Button>
                    <Button
                      variant={selectedView === "grouped" ? "default" : "ghost"}
                      onClick={() => setSelectedView("grouped")}
                      size="sm"
                      className={`rounded-md transition-all duration-200 ${
                        selectedView === "grouped" 
                          ? "bg-gradient-to-r from-blue-600 to-cyan-600 text-white shadow-sm" 
                          : "hover:bg-background/80"
                      }`}
                    >
                      Grouped by Item
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {loading ? (
            <Card className="border-none shadow-md">
              <CardContent className="py-12">
                <div className="flex flex-col items-center gap-4">
                  <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                  <div className="text-center text-muted-foreground">Loading sales data...</div>
                </div>
              </CardContent>
            </Card>
          ) : selectedView === "sales" ? (
            <Card className="border-none shadow-md">
              <CardHeader>
                <CardTitle>Sales Transactions</CardTitle>
              </CardHeader>
              <CardContent>
                {!hasAnyConnectedSystem() ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <p className="mb-2">No POS systems connected.</p>
                    <p>Connect to Square or record manual sales to get started.</p>
                  </div>
                ) : dateFilteredSales.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No sales found for the selected date range.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {dateFilteredSales.map((sale, index) => {
                      // If sale is split, show the SplitSaleView component
                      if (sale.is_split && sale.child_splits && sale.child_splits.length > 0) {
                        return (
                          <div
                            key={sale.id}
                            className="animate-fade-in"
                            style={{ animationDelay: `${index * 50}ms` }}
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
                      
                      // Regular sale card (non-split)
                      const posSystemColors: Record<string, string> = {
                        "Square": "border-l-blue-500",
                        "Clover": "border-l-green-500",
                        "Toast": "border-l-orange-500",
                        "manual": "border-l-purple-500",
                        "manual_upload": "border-l-purple-500",
                      };
                      
                      return (
                        <div
                          key={sale.id}
                          className={`flex flex-col sm:flex-row sm:items-center justify-between p-4 border-l-4 ${
                            posSystemColors[sale.posSystem] || "border-l-gray-500"
                          } rounded-lg bg-gradient-to-r from-background to-muted/30 hover:shadow-md hover:scale-[1.01] transition-all duration-300 gap-3 animate-fade-in`}
                          style={{ 
                            animationDelay: `${index * 50}ms`,
                            backgroundColor: index % 2 === 0 ? undefined : 'hsl(var(--muted) / 0.3)'
                          }}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-2">
                              <IntegrationLogo
                                integrationId={sale.posSystem.toLowerCase().replace("_", "-") + "-pos"}
                                size={20}
                              />
                              <h3 className="font-semibold text-base truncate">{sale.itemName}</h3>
                              <Badge variant="secondary" className="text-xs font-medium">
                                Qty: {sale.quantity}
                              </Badge>
                              {sale.totalPrice && (
                                <Badge variant="outline" className="text-xs font-semibold bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20">
                                  ${sale.totalPrice.toFixed(2)}
                                </Badge>
                              )}
                              <Badge variant="outline" className="text-xs">
                                {sale.posSystem}
                              </Badge>
                              {unmappedItems.includes(sale.itemName) ? (
                                <Badge
                                  variant="destructive"
                                  className="text-xs cursor-pointer hover:scale-105 transition-transform animate-pulse"
                                  onClick={() => handleMapPOSItem(sale.itemName)}
                                >
                                  No Recipe
                                </Badge>
                              ) : recipeByItemName.has(sale.itemName.toLowerCase()) ? (
                                <Badge
                                  variant="outline"
                                  className="text-xs cursor-pointer hover:scale-105 transition-all bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30 hover:bg-blue-500/20"
                                  onClick={() => navigate(`/recipes?recipeId=${recipeByItemName.get(sale.itemName.toLowerCase())?.id}`)}
                                >
                                  {!recipeByItemName.get(sale.itemName.toLowerCase())?.hasIngredients && (
                                    <AlertTriangle className="h-3 w-3 mr-1 text-amber-500" />
                                  )}
                                  <ExternalLink className="h-3 w-3 mr-1" />
                                  {recipeByItemName.get(sale.itemName.toLowerCase())?.name}
                                  {recipeByItemName.get(sale.itemName.toLowerCase())?.profitMargin != null && (
                                    <span className="ml-1 font-semibold">
                                      ({recipeByItemName.get(sale.itemName.toLowerCase())!.profitMargin!.toFixed(0)}%)
                                    </span>
                                  )}
                                </Badge>
                              ) : null}
                              {sale.suggested_category_id && !sale.is_categorized && (
                                <Badge variant="outline" className="bg-accent/10 text-accent-foreground border-accent/30">
                                  <Sparkles className="h-3 w-3 mr-1" />
                                  AI Suggested
                                </Badge>
                              )}
                              {sale.is_categorized && sale.chart_account && (
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
                                    {sale.chart_account.account_code} - {sale.chart_account.account_name}
                                  </Badge>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 px-2 text-xs"
                                    onClick={() => setEditingCategoryForSale(sale.id)}
                                  >
                                    Edit
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 px-2 text-xs"
                                    onClick={() => handleSuggestRuleFromSale(sale)}
                                    title="Create a rule based on this sale"
                                  >
                                    <Settings2 className="h-3 w-3" />
                                  </Button>
                                </div>
                              )}
                              {/* Show Split button for all sales (categorized or not) */}
                              {!sale.is_split && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-2 text-xs"
                                  onClick={() => setSaleToSplit(sale)}
                                >
                                  <Split className="h-3 w-3 mr-1" />
                                  Split
                                </Button>
                              )}
                              {sale.ai_confidence && sale.suggested_category_id && !sale.is_categorized && (
                                <Badge 
                                  variant="outline"
                                  className={
                                    sale.ai_confidence === 'high' 
                                      ? 'bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/30'
                                      : sale.ai_confidence === 'medium'
                                      ? 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 border-yellow-500/30'
                                      : 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30'
                                  }
                                >
                                  {sale.ai_confidence}
                                </Badge>
                              )}
                              {!sale.is_categorized && !sale.suggested_category_id && editingCategoryForSale !== sale.id && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-6 px-2 text-xs border-primary/50 hover:bg-primary/10"
                                  onClick={() => setEditingCategoryForSale(sale.id)}
                                >
                                  Categorize
                                </Button>
                              )}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {(() => {
                                const [year, month, day] = sale.saleDate.split("-").map(Number);
                                const localDate = new Date(year, month - 1, day);
                                return format(localDate, "MMM d, yyyy");
                              })()}
                              {sale.saleTime && ` at ${sale.saleTime}`}
                              {sale.externalOrderId && (
                                <>
                                  <br className="sm:hidden" />
                                  <span className="hidden sm:inline"> • </span>
                                  <span className="font-mono text-xs break-all max-w-full">Order: {sale.externalOrderId}</span>
                                </>
                              )}
                            </div>
                            {sale.suggested_category_id && !sale.is_categorized && sale.chart_account && (
                              <div className="mt-2 p-2 bg-accent/5 border border-accent/20 rounded-md">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                  <div className="text-xs text-muted-foreground flex-1">
                                    <span className="font-medium text-foreground">AI Suggestion:</span> {sale.chart_account.account_name} ({sale.chart_account.account_code})
                                    {sale.ai_reasoning && <div className="mt-1 text-xs">{sale.ai_reasoning}</div>}
                                  </div>
                                  <div className="flex gap-1">
                                    <Button
                                      size="sm"
                                      variant="default"
                                      className="text-xs h-7 px-2"
                                     onClick={() => categorizePosSale({ 
                                       saleId: sale.id, 
                                       categoryId: sale.suggested_category_id!,
                                       accountInfo: {
                                         account_name: sale.chart_account.account_name,
                                         account_code: sale.chart_account.account_code,
                                       }
                                     })}
                                    >
                                      <Check className="h-3 w-3 mr-1" />
                                      Approve
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="text-xs h-7 px-2"
                                      onClick={() => setSaleToSplit(sale)}
                                    >
                                      <Split className="h-3 w-3 mr-1" />
                                      Split
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="text-xs h-7 px-2"
                                      onClick={() => setEditingCategoryForSale(sale.id)}
                                    >
                                      <X className="h-3 w-3 mr-1" />
                                      Change
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            )}
                            {editingCategoryForSale === sale.id && (
                              <div className="mt-2 p-2 bg-muted/50 border border-border rounded-md">
                                <div className="flex items-center gap-2">
                                  <div className="flex-1">
                                     <SearchableAccountSelector
                                       value={sale.category_id || sale.suggested_category_id || ""}
                                       onValueChange={(categoryId) => {
                                         const selectedAccount = accounts.find(acc => acc.id === categoryId);
                                         categorizePosSale({ 
                                           saleId: sale.id, 
                                           categoryId,
                                           accountInfo: selectedAccount ? {
                                             account_name: selectedAccount.account_name,
                                             account_code: selectedAccount.account_code,
                                           } : undefined
                                         });
                                         setEditingCategoryForSale(null);
                                       }}
                                       placeholder="Select category"
                                       filterByTypes={['revenue', 'liability']}
                                     />
                                  </div>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setEditingCategoryForSale(null)}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {(sale.posSystem === "manual" || sale.posSystem === "manual_upload") &&
                              selectedRestaurant &&
                              (selectedRestaurant.role === "owner" || selectedRestaurant.role === "manager") && (
                                <>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleEditSale(sale)}
                                    className="text-xs hover:bg-blue-500/10 hover:border-blue-500/50 transition-all duration-200"
                                  >
                                    Edit
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleDeleteSale(sale.id)}
                                    className="text-xs text-destructive hover:bg-destructive/10 hover:border-destructive/50 transition-all duration-200"
                                  >
                                    Delete
                                  </Button>
                                </>
                              )}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleSimulateDeduction(sale.itemName, sale.quantity)}
                              className="w-full sm:w-auto text-xs hover:bg-primary/10 hover:border-primary/50 transition-all duration-200"
                            >
                              <span className="hidden sm:inline">Simulate Impact</span>
                              <span className="sm:hidden">Impact</span>
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card className="border-none shadow-md">
              <CardHeader>
                <CardTitle className="text-lg md:text-xl">Sales Summary by Item</CardTitle>
              </CardHeader>
              <CardContent>
                {groupedSales.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No sales data available.</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {groupedSales.map(
                      (item: {
                        item_name: string;
                        total_quantity: number;
                        sale_count: number;
                        total_revenue: number;
                      }, index: number) => {
                        const maxRevenue = Math.max(...groupedSales.map((g: any) => g.total_revenue));
                        const revenuePercentage = (item.total_revenue / maxRevenue) * 100;
                        
                        return (
                          <Card 
                            key={item.item_name} 
                            className="border-l-4 border-l-primary hover:shadow-lg transition-all duration-300 animate-fade-in"
                            style={{ animationDelay: `${index * 50}ms` }}
                          >
                            <CardContent className="p-5 space-y-4">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1">
                                  <h3 className="font-semibold text-base mb-1 line-clamp-2">{item.item_name}</h3>
                                  {unmappedItems.includes(item.item_name) ? (
                                    <Badge
                                      variant="destructive"
                                      className="cursor-pointer hover:scale-105 transition-transform animate-pulse text-xs"
                                      onClick={() => handleMapPOSItem(item.item_name)}
                                    >
                                      No Recipe
                                    </Badge>
                                  ) : recipeByItemName.has(item.item_name.toLowerCase()) ? (
                                    <Badge
                                      variant="outline"
                                      className="text-xs cursor-pointer hover:scale-105 transition-all bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30 hover:bg-blue-500/20"
                                      onClick={() => navigate(`/recipes?recipeId=${recipeByItemName.get(item.item_name.toLowerCase())?.id}`)}
                                    >
                                      {!recipeByItemName.get(item.item_name.toLowerCase())?.hasIngredients && (
                                        <AlertTriangle className="h-3 w-3 mr-1 text-amber-500" />
                                      )}
                                      <ExternalLink className="h-3 w-3 mr-1" />
                                      {recipeByItemName.get(item.item_name.toLowerCase())?.name}
                                      {recipeByItemName.get(item.item_name.toLowerCase())?.profitMargin != null && (
                                        <span className="ml-1 font-semibold">
                                          ({recipeByItemName.get(item.item_name.toLowerCase())!.profitMargin!.toFixed(0)}%)
                                        </span>
                                      )}
                                    </Badge>
                                  ) : null}
                                </div>
                                <Badge 
                                  variant="secondary"
                                  className="text-lg font-bold px-3 py-1 bg-gradient-to-br from-blue-500/10 to-cyan-500/10"
                                >
                                  ${item.total_revenue.toFixed(2)}
                                </Badge>
                              </div>

                              {/* Progress bar for revenue */}
                              <div className="space-y-1">
                                <div className="flex justify-between text-xs text-muted-foreground">
                                  <span>vs Top Seller (${maxRevenue.toFixed(2)})</span>
                                  <span className="font-medium">{revenuePercentage.toFixed(0)}%</span>
                                </div>
                                <div className="h-2 bg-muted rounded-full overflow-hidden">
                                  <div 
                                    className="h-full bg-gradient-to-r from-blue-500 to-cyan-500 rounded-full transition-all duration-500"
                                    style={{ width: `${revenuePercentage}%` }}
                                  />
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-3">
                                <div className="text-center p-3 rounded-lg bg-muted/50">
                                  <p className="text-2xl font-bold">{item.total_quantity}</p>
                                  <p className="text-xs text-muted-foreground">Total Qty</p>
                                </div>
                                <div className="text-center p-3 rounded-lg bg-muted/50">
                                  <p className="text-2xl font-bold">{item.sale_count}</p>
                                  <p className="text-xs text-muted-foreground">Sales Count</p>
                                </div>
                              </div>

                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleSimulateDeduction(item.item_name, item.total_quantity)}
                                className="w-full hover:bg-primary/10 hover:border-primary/50 transition-all duration-200"
                              >
                                Check Recipe Impact
                              </Button>
                              <p className="text-xs text-muted-foreground text-center">
                                Shows total impact - some sales may already be processed
                              </p>
                            </CardContent>
                          </Card>
                        );
                      },
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
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
    </div>
  );
}
