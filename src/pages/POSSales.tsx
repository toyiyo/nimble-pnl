import React, { useState, useEffect, useMemo } from "react";
import { Plus, Download, Search, Calendar, RefreshCw, Upload as UploadIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
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

export default function POSSales() {
  const {
    selectedRestaurant,
    setSelectedRestaurant,
    restaurants,
    loading: restaurantsLoading,
    createRestaurant,
  } = useRestaurantContext();
  const { sales, loading, getSalesByDateRange, getSalesGroupedByItem, unmappedItems, deleteManualSale } =
    useUnifiedSales(selectedRestaurant?.restaurant_id || null);
  const { hasAnyConnectedSystem, syncAllSystems, isSyncing, integrationStatuses } = usePOSIntegrations(
    selectedRestaurant?.restaurant_id || null,
  );
  const { simulateDeduction } = useInventoryDeduction();

  const [searchTerm, setSearchTerm] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
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
    let filtered = sales.filter((sale) => sale.itemName.toLowerCase().includes(searchTerm.toLowerCase()));
    
    if (startDate && endDate) {
      filtered = filtered.filter((sale) => sale.saleDate >= startDate && sale.saleDate <= endDate);
    }
    
    return filtered;
  }, [sales, searchTerm, startDate, endDate]);

  const dateFilteredSales = filteredSales;

  const handleSyncSales = async () => {
    if (selectedRestaurant?.restaurant_id) {
      await syncAllSystems();
    }
  };

  const groupedSales = useMemo(() => {
    return getSalesGroupedByItem();
  }, [getSalesGroupedByItem]);

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

  // Calculate dashboard metrics - MUST be before conditional return to follow Rules of Hooks
  const dashboardMetrics = useMemo(() => {
    const totalSales = filteredSales.length;
    const totalRevenue = filteredSales.reduce((sum, sale) => sum + (sale.totalPrice || 0), 0);
    const uniqueItems = new Set(filteredSales.map(sale => sale.itemName)).size;
    
    return {
      totalSales,
      totalRevenue,
      uniqueItems,
      unmappedCount: unmappedItems.length,
    };
  }, [filteredSales, unmappedItems]);

  const activeFiltersCount = [searchTerm, startDate, endDate].filter(Boolean).length;

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
              <Button 
                variant="outline" 
                className="flex items-center gap-2 hover:bg-background/80 transition-all duration-300"
              >
                <Download className="h-4 w-4" />
                <span className="hidden sm:inline">Export Data</span>
                <span className="sm:hidden">Export</span>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Dashboard Metrics */}
      <POSSalesDashboard
        totalSales={dashboardMetrics.totalSales}
        totalRevenue={dashboardMetrics.totalRevenue}
        uniqueItems={dashboardMetrics.uniqueItems}
        unmappedCount={dashboardMetrics.unmappedCount}
      />

      {/* POS System Status Cards */}
      {integrationStatuses.length > 0 && (
        <POSSystemStatus
          integrationStatuses={integrationStatuses}
          onSync={handleSyncSales}
          isSyncing={isSyncing}
        />
      )}

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
                              {unmappedItems.includes(sale.itemName) && (
                                <Badge
                                  variant="destructive"
                                  className="text-xs cursor-pointer hover:scale-105 transition-transform animate-pulse"
                                  onClick={() => handleMapPOSItem(sale.itemName)}
                                >
                                  No Recipe
                                </Badge>
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
                                  {unmappedItems.includes(item.item_name) && (
                                    <Badge
                                      variant="destructive"
                                      className="cursor-pointer hover:scale-105 transition-transform animate-pulse text-xs"
                                      onClick={() => handleMapPOSItem(item.item_name)}
                                    >
                                      No Recipe
                                    </Badge>
                                  )}
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
                                  <span>Revenue contribution</span>
                                  <span>{revenuePercentage.toFixed(0)}%</span>
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
    </div>
  );
}
