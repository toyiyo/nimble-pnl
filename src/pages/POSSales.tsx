import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Download, Search, Calendar, RefreshCw, Upload as UploadIcon } from "lucide-react";
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
import { format } from "date-fns";
import { InventoryDeductionDialog } from "@/components/InventoryDeductionDialog";
import { MapPOSItemDialog } from "@/components/MapPOSItemDialog";
import { UnifiedSaleItem } from "@/types/pos";

export default function POSSales() {
  const navigate = useNavigate();
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

  // Auto-sync when restaurant is selected
  useEffect(() => {
    if (selectedRestaurant?.restaurant_id && hasAnyConnectedSystem()) {
      syncAllSystems();
    }
  }, [selectedRestaurant?.restaurant_id, hasAnyConnectedSystem, syncAllSystems]);

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
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        <div className="text-center lg:text-left">
          <h1 className="text-2xl md:text-3xl font-bold">POS Sales</h1>
          <p className="text-sm md:text-base text-muted-foreground">
            Unified sales data from all connected POS systems for {selectedRestaurant.restaurant.name}
          </p>
          <div className="flex flex-wrap gap-1 md:gap-2 mt-2 justify-center lg:justify-start">
            {integrationStatuses.map((status) => (
              <Badge key={status.system} variant={status.isConnected ? "default" : "secondary"} className="text-xs">
                {status.system} {status.isConnected ? "✓" : "○"}
              </Badge>
            ))}
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setActiveTab("manual");
              setEditingSale(null);
              setShowSaleDialog(true);
            }}
            className="flex items-center gap-2 w-full sm:w-auto"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Record Manual Sale</span>
            <span className="sm:hidden">Manual Sale</span>
          </Button>
          <Button
            variant="outline"
            onClick={() => setActiveTab("import")}
            className="flex items-center gap-2 w-full sm:w-auto"
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
              className="flex items-center gap-2 w-full sm:w-auto"
            >
              <RefreshCw className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`} />
              {isSyncing ? "Syncing..." : "Sync Sales"}
            </Button>
          )}
          <Button variant="outline" className="flex items-center gap-2 w-full sm:w-auto">
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Export Data</span>
            <span className="sm:hidden">Export</span>
          </Button>
          {unmappedItems.length > 0 && (
            <Badge variant="secondary" className="w-full sm:w-auto text-xs justify-center">
              {unmappedItems.length} items need recipes
            </Badge>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "manual" | "import")} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="manual">View Sales</TabsTrigger>
          <TabsTrigger value="import">Import from File</TabsTrigger>
        </TabsList>

        <TabsContent value="manual" className="space-y-6">
          <div className="grid gap-4 md:gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base md:text-lg">Filters & Search</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="w-full">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by item name..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10 text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="pl-10 text-sm"
                      placeholder="Start date"
                    />
                  </div>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="pl-10 text-sm"
                      placeholder="End date"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Button
                    variant={selectedView === "sales" ? "default" : "outline"}
                    onClick={() => setSelectedView("sales")}
                    size="sm"
                    className="w-full"
                  >
                    <span className="hidden sm:inline">Individual Sales</span>
                    <span className="sm:hidden">Sales</span>
                  </Button>
                  <Button
                    variant={selectedView === "grouped" ? "default" : "outline"}
                    onClick={() => setSelectedView("grouped")}
                    size="sm"
                    className="w-full"
                  >
                    <span className="hidden sm:inline">Grouped by Item</span>
                    <span className="sm:hidden">Grouped</span>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {loading ? (
            <Card>
              <CardContent className="py-8">
                <div className="text-center text-muted-foreground">Loading sales data...</div>
              </CardContent>
            </Card>
          ) : selectedView === "sales" ? (
            <Card>
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
                  <div className="space-y-3 md:space-y-4">
                    {dateFilteredSales.map((sale) => (
                      <div
                        key={sale.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between p-3 md:p-4 border rounded-lg hover:bg-muted/50 gap-3 sm:gap-2"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-1 md:gap-2 mb-2">
                            <h3 className="font-medium text-sm md:text-base truncate">{sale.itemName}</h3>
                            <Badge variant="secondary" className="text-xs">
                              Qty: {sale.quantity}
                            </Badge>
                            {sale.totalPrice && (
                              <Badge variant="outline" className="text-xs">
                                ${sale.totalPrice.toFixed(2)}
                              </Badge>
                            )}
                            <Badge variant="outline" className="text-xs">
                              {sale.posSystem}
                            </Badge>
                            {unmappedItems.includes(sale.itemName) && (
                              <Badge
                                variant="destructive"
                                className="text-xs cursor-pointer hover:bg-destructive/80 transition-colors"
                                onClick={() => handleMapPOSItem(sale.itemName)}
                              >
                                No Recipe
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs md:text-sm text-muted-foreground">
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
                                Order: {sale.externalOrderId}
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
                                  className="text-xs"
                                >
                                  Edit
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleDeleteSale(sale.id)}
                                  className="text-xs text-destructive hover:text-destructive"
                                >
                                  Delete
                                </Button>
                              </>
                            )}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleSimulateDeduction(sale.itemName, sale.quantity)}
                            className="w-full sm:w-auto text-xs"
                          >
                            <span className="hidden sm:inline">Simulate Impact</span>
                            <span className="sm:hidden">Impact</span>
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Sales Summary by Item</CardTitle>
              </CardHeader>
              <CardContent>
                {groupedSales.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No sales data available.</div>
                ) : (
                  <div className="space-y-4">
                    {groupedSales.map(
                      (item: {
                        item_name: string;
                        total_quantity: number;
                        sale_count: number;
                        total_revenue: number;
                      }) => (
                        <div key={item.item_name} className="flex items-center justify-between p-4 border rounded-lg">
                          <div className="flex-1">
                            <h3 className="font-medium">{item.item_name}</h3>
                            <div className="flex gap-4 text-sm text-muted-foreground mt-1">
                              <span>Total Quantity: {item.total_quantity}</span>
                              <span>Sales Count: {item.sale_count}</span>
                              <span>Total Revenue: ${item.total_revenue.toFixed(2)}</span>
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleSimulateDeduction(item.item_name, 1)}
                          >
                            Check Recipe Impact
                          </Button>
                        </div>
                      ),
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
