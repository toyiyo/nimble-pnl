import { useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Package,
  Plus,
  Search,
  DollarSign,
  TrendingDown,
  Calculator,
  Boxes,
  Upload,
} from 'lucide-react';
import { useAssets } from '@/hooks/useAssets';
import { useAssetsPendingDepreciation } from '@/hooks/useAssetDepreciation';
import {
  AssetList,
  AssetDialog,
  AssetDepreciationSheet,
  AssetDisposeDialog,
  AssetImportUpload,
  AssetImportReview,
} from '@/components/assets';
import type { Asset, AssetFormData, AssetStatus, AssetWithDetails } from '@/types/assets';
import { formatAssetCurrency, DEFAULT_ASSET_CATEGORIES } from '@/types/assets';
import type { AssetLineItem } from '@/types/assetImport';
import { FeatureGate } from '@/components/subscription';

type StatusFilter = AssetStatus | 'all';

function MetricCard({
  title,
  value,
  icon: Icon,
  description,
  className = '',
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  description?: string;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </CardContent>
    </Card>
  );
}

export default function Assets() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Dialog states
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<AssetWithDetails | null>(null);
  const [isDepreciationOpen, setIsDepreciationOpen] = useState(false);
  const [depreciationAsset, setDepreciationAsset] = useState<AssetWithDetails | null>(null);
  const [isDisposeOpen, setIsDisposeOpen] = useState(false);
  const [disposeAsset, setDisposeAsset] = useState<AssetWithDetails | null>(null);

  // Import states
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [importedItems, setImportedItems] = useState<AssetLineItem[]>([]);
  const [importDocumentFile, setImportDocumentFile] = useState<File | undefined>(undefined);

  const {
    assets,
    isLoading,
    error,
    refetch,
    createAssetAsync,
    updateAssetAsync,
    disposeAsset: handleDisposeAsset,
    deleteAsset,
    isCreating,
    isUpdating,
    isDisposing,
    summary,
  } = useAssets({ status: statusFilter === 'all' ? 'all' : statusFilter });

  const { count: pendingDepreciationCount } = useAssetsPendingDepreciation();

  // Filter assets by category and search
  const filteredAssets = assets.filter((asset) => {
    const matchesCategory = categoryFilter === 'all' || asset.category === categoryFilter;
    const matchesSearch =
      !searchQuery ||
      asset.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      asset.serial_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      asset.category.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesCategory && matchesSearch;
  });

  // Get unique categories from current assets
  const usedCategories = [...new Set(assets.map((a) => a.category))];

  const handleEdit = (asset: AssetWithDetails) => {
    setSelectedAsset(asset);
    setIsDialogOpen(true);
  };

  const handleViewPhotos = (asset: AssetWithDetails) => {
    setSelectedAsset(asset);
    setIsDialogOpen(true);
    // The dialog will open to the photos tab if the asset exists
  };

  const handleDepreciate = (asset: AssetWithDetails) => {
    setDepreciationAsset(asset);
    setIsDepreciationOpen(true);
  };

  const handleDispose = (asset: AssetWithDetails) => {
    setDisposeAsset(asset);
    setIsDisposeOpen(true);
  };

  const handleSave = async (data: AssetFormData): Promise<Asset | void> => {
    if (selectedAsset) {
      await updateAssetAsync({ id: selectedAsset.id, data });
    } else {
      const newAsset = await createAssetAsync(data);
      return newAsset;
    }
    setIsDialogOpen(false);
    setSelectedAsset(null);
  };

  const handleConfirmDispose = (id: string, data: { disposal_date: string; disposal_proceeds?: number; disposal_notes?: string }) => {
    handleDisposeAsset({ id, data });
    setIsDisposeOpen(false);
    setDisposeAsset(null);
  };

  // Import handlers
  const handleDocumentProcessed = useCallback((items: AssetLineItem[], documentFile?: File) => {
    setImportedItems(items);
    setImportDocumentFile(documentFile);
  }, []);

  const handleImportComplete = useCallback(() => {
    setIsImportDialogOpen(false);
    setImportedItems([]);
    setImportDocumentFile(undefined);
    refetch();
  }, [refetch]);

  const handleImportCancel = useCallback(() => {
    setIsImportDialogOpen(false);
    setImportedItems([]);
    setImportDocumentFile(undefined);
  }, []);

  return (
    <FeatureGate featureKey="assets">
    <div className="space-y-6">
      {/* Hero Section */}
      <div className="rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 p-6 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Package className="h-7 w-7" />
              Assets & Equipment
            </h1>
            <p className="text-blue-100 mt-1">
              Track fixed assets, depreciation, and equipment across your restaurant.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setIsImportDialogOpen(true)}
              className="bg-white/10 text-white border-white/20 hover:bg-white/20"
            >
              <Upload className="h-4 w-4 mr-2" />
              Import Assets
            </Button>
            <Button
              onClick={() => {
                setSelectedAsset(null);
                setIsDialogOpen(true);
              }}
              className="bg-white text-blue-600 hover:bg-blue-50"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Asset
            </Button>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard
          title="Total Assets"
          value={summary.totalAssets}
          icon={Boxes}
          description={`${summary.activeAssets} active`}
        />
        <MetricCard
          title="Total Cost"
          value={formatAssetCurrency(summary.totalCost)}
          icon={DollarSign}
          description="Original purchase value"
        />
        <MetricCard
          title="Net Book Value"
          value={formatAssetCurrency(summary.totalNetBookValue)}
          icon={TrendingDown}
          description="Current book value"
        />
        <MetricCard
          title="Pending Depreciation"
          value={pendingDepreciationCount}
          icon={Calculator}
          description={pendingDepreciationCount > 0 ? 'Assets need depreciation' : 'All caught up'}
          className={pendingDepreciationCount > 0 ? 'border-amber-200 bg-amber-50 dark:bg-amber-950/20' : ''}
        />
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Assets</CardTitle>
          <CardDescription>
            Manage your equipment, furniture, and other fixed assets.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            {/* Status Tabs */}
            <Tabs
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as StatusFilter)}
            >
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="active">Active</TabsTrigger>
                <TabsTrigger value="fully_depreciated">Fully Depreciated</TabsTrigger>
                <TabsTrigger value="disposed">Disposed</TabsTrigger>
              </TabsList>
            </Tabs>

            {/* Search and Category Filter */}
            <div className="flex gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search assets..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 w-[200px]"
                />
              </div>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {DEFAULT_ASSET_CATEGORIES.map((cat) => (
                    <SelectItem key={cat.name} value={cat.name}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Asset List */}
          <div className="mt-6">
            {error && (
              <Alert variant="destructive" className="mb-4">
                <AlertTitle>Error Loading Assets</AlertTitle>
                <AlertDescription className="flex items-center justify-between">
                  <span>
                    {error instanceof Error ? error.message : 'Failed to load assets. Please try again.'}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => refetch()}
                    className="ml-4"
                  >
                    Retry
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            {!error && (
              <AssetList
                assets={filteredAssets}
                isLoading={isLoading}
                onEdit={handleEdit}
                onDispose={handleDispose}
                onDelete={deleteAsset}
                onViewPhotos={handleViewPhotos}
                onDepreciate={handleDepreciate}
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* Dialogs */}
      <AssetDialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) setSelectedAsset(null);
        }}
        asset={selectedAsset}
        onSave={handleSave}
        isSaving={isCreating || isUpdating}
      />

      <AssetDepreciationSheet
        open={isDepreciationOpen}
        onOpenChange={(open) => {
          setIsDepreciationOpen(open);
          if (!open) setDepreciationAsset(null);
        }}
        asset={depreciationAsset}
      />

      <AssetDisposeDialog
        open={isDisposeOpen}
        onOpenChange={(open) => {
          setIsDisposeOpen(open);
          if (!open) setDisposeAsset(null);
        }}
        asset={disposeAsset}
        onDispose={handleConfirmDispose}
        isDisposing={isDisposing}
      />

      {/* Asset Import Dialog */}
      <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import Assets</DialogTitle>
            <DialogDescription>
              Upload an invoice, receipt, or CSV to bulk import assets
            </DialogDescription>
          </DialogHeader>
          {importedItems.length === 0 ? (
            <AssetImportUpload onDocumentProcessed={handleDocumentProcessed} />
          ) : (
            <AssetImportReview
              initialItems={importedItems}
              documentFile={importDocumentFile}
              onImportComplete={handleImportComplete}
              onCancel={handleImportCancel}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
    </FeatureGate>
  );
}
