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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Package,
  Plus,
  Search,
  DollarSign,
  TrendingDown,
  Boxes,
  Upload,
  AlertTriangle,
  CheckCircle,
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

interface MetricCardProps {
  title: string;
  value: string | number;
  icon: React.ElementType;
  description?: string;
  trend?: 'positive' | 'warning' | 'neutral';
  className?: string;
}

function MetricCard({
  title,
  value,
  icon: Icon,
  description,
  trend = 'neutral',
  className = '',
}: MetricCardProps) {
  const iconBgColors = {
    positive: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400',
    warning: 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400',
    neutral: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400',
  };

  return (
    <Card className={`overflow-hidden ${className}`}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs sm:text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 truncate">{title}</p>
            <p className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 truncate">{value}</p>
            {description && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 truncate">{description}</p>
            )}
          </div>
          <div className={`p-2 sm:p-2.5 rounded-lg flex-shrink-0 ${iconBgColors[trend]}`}>
            <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
          </div>
        </div>
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

  const handleEdit = (asset: AssetWithDetails) => {
    setSelectedAsset(asset);
    setIsDialogOpen(true);
  };

  const handleViewPhotos = (asset: AssetWithDetails) => {
    setSelectedAsset(asset);
    setIsDialogOpen(true);
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
    <div className="space-y-6 p-4 sm:p-6">
      {/* Hero Section */}
      <div className="relative rounded-2xl bg-gradient-to-br from-blue-600 via-blue-600 to-indigo-700 p-5 sm:p-8 text-white overflow-hidden">
        {/* Background decoration */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/3" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/3" />

        <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2.5 rounded-xl bg-white/10 backdrop-blur-sm">
                <Package className="h-6 w-6 sm:h-7 sm:w-7" />
              </div>
              <h1 className="text-xl sm:text-2xl font-bold">Assets & Equipment</h1>
            </div>
            <p className="text-blue-100 text-sm sm:text-base max-w-md">
              Track fixed assets, depreciation, and equipment across your restaurant.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
            <Button
              variant="outline"
              onClick={() => setIsImportDialogOpen(true)}
              className="bg-white/10 text-white border-white/20 hover:bg-white/20 backdrop-blur-sm"
            >
              <Upload className="h-4 w-4 mr-2" />
              Import
            </Button>
            <Button
              onClick={() => {
                setSelectedAsset(null);
                setIsDialogOpen(true);
              }}
              className="bg-white text-blue-600 hover:bg-blue-50 shadow-lg shadow-blue-900/20"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Asset
            </Button>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <MetricCard
          title="Total Assets"
          value={summary.totalAssets}
          icon={Boxes}
          description={`${summary.activeAssets} active`}
          trend="neutral"
        />
        <MetricCard
          title="Total Cost"
          value={formatAssetCurrency(summary.totalCost)}
          icon={DollarSign}
          description="Original purchase value"
          trend="neutral"
        />
        <MetricCard
          title="Net Book Value"
          value={formatAssetCurrency(summary.totalNetBookValue)}
          icon={TrendingDown}
          description="Current book value"
          trend="positive"
        />
        <MetricCard
          title="Pending Depreciation"
          value={pendingDepreciationCount}
          icon={pendingDepreciationCount > 0 ? AlertTriangle : CheckCircle}
          description={pendingDepreciationCount > 0 ? 'Assets need depreciation' : 'All caught up'}
          trend={pendingDepreciationCount > 0 ? 'warning' : 'positive'}
          className={pendingDepreciationCount > 0 ? 'ring-1 ring-amber-200 dark:ring-amber-800' : ''}
        />
      </div>

      {/* Filters */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-3 px-4 sm:px-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <CardTitle className="text-lg">Assets</CardTitle>
              <CardDescription className="text-sm">
                Manage your equipment, furniture, and other fixed assets.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-4 sm:px-6 pb-4 sm:pb-6">
          {/* Filter Controls */}
          <div className="flex flex-col gap-4">
            {/* Status Tabs - scrollable on mobile */}
            <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
              <Tabs
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as StatusFilter)}
              >
                <TabsList className="inline-flex h-9 min-w-max">
                  <TabsTrigger value="all" className="text-xs sm:text-sm px-2.5 sm:px-3">All</TabsTrigger>
                  <TabsTrigger value="active" className="text-xs sm:text-sm px-2.5 sm:px-3">Active</TabsTrigger>
                  <TabsTrigger value="fully_depreciated" className="text-xs sm:text-sm px-2.5 sm:px-3 whitespace-nowrap">Fully Depreciated</TabsTrigger>
                  <TabsTrigger value="disposed" className="text-xs sm:text-sm px-2.5 sm:px-3">Disposed</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {/* Search and Category Filter */}
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
              <div className="relative flex-1 sm:max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Search assets..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-10 bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700"
                />
              </div>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-full sm:w-[180px] h-10 bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700">
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
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Error Loading Assets</AlertTitle>
                <AlertDescription className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <span className="text-sm">
                    {error instanceof Error ? error.message : 'Failed to load assets. Please try again.'}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => refetch()}
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
        <DialogContent className="max-w-6xl w-[95vw] max-h-[95vh] overflow-hidden flex flex-col p-0">
          <DialogHeader className="sr-only">
            <DialogTitle>Import Assets</DialogTitle>
            <DialogDescription>
              Upload an invoice, receipt, or CSV to bulk import assets
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto p-4 sm:p-6">
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
          </div>
        </DialogContent>
      </Dialog>
    </div>
    </FeatureGate>
  );
}
