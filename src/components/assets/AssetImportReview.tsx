import { useState, useCallback, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertCircle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Loader2,
  Package,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useAssetImport } from '@/hooks/useAssetImport';
import { DEFAULT_ASSET_CATEGORIES, formatAssetCurrency } from '@/types/assets';
import type { AssetLineItem } from '@/types/assetImport';

interface AssetImportReviewProps {
  initialItems: AssetLineItem[];
  documentFile?: File;
  onImportComplete: () => void;
  onCancel: () => void;
}

export function AssetImportReview({
  initialItems,
  documentFile,
  onImportComplete,
  onCancel,
}: AssetImportReviewProps) {
  const [items, setItems] = useState<AssetLineItem[]>(initialItems);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const { bulkImportAssets, isImporting, importProgress } = useAssetImport();

  // Calculated stats
  const stats = useMemo(() => {
    const pending = items.filter(i => i.importStatus === 'pending').length;
    const imported = items.filter(i => i.importStatus === 'imported').length;
    const errored = items.filter(i => i.importStatus === 'error').length;
    const totalCost = items.reduce((sum, i) => sum + i.purchaseCost, 0);
    const needsPrice = items.filter(i => i.importStatus === 'pending' && i.purchaseCost <= 0).length;
    const readyToImport = items.filter(i => i.importStatus === 'pending' && i.purchaseCost > 0).length;

    return { pending, imported, errored, totalCost, total: items.length, needsPrice, readyToImport };
  }, [items]);

  const handleUpdateItem = useCallback((id: string, updates: Partial<AssetLineItem>) => {
    setItems(prev => prev.map(item => (item.id === id ? { ...item, ...updates } : item)));
  }, []);

  const handleRemoveItem = useCallback((id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
  }, []);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleImport = useCallback(async () => {
    const pendingItems = items.filter(i => i.importStatus === 'pending' && i.purchaseCost > 0);
    if (pendingItems.length === 0) return;

    const result = await bulkImportAssets(pendingItems, documentFile);

    setItems(prev =>
      prev.map(item => {
        const errorEntry = result.errors.find(e => e.itemName === item.parsedName);
        if (errorEntry) {
          return { ...item, importStatus: 'error', errorMessage: errorEntry.error };
        }
        if (item.importStatus === 'pending') {
          return { ...item, importStatus: 'imported' };
        }
        return item;
      })
    );

    if (result.success && result.failedCount === 0) {
      onImportComplete();
    }
  }, [items, bulkImportAssets, documentFile, onImportComplete]);

  const getConfidenceBadge = (score: number) => {
    if (score >= 0.85) {
      return (
        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-xs">
          High
        </Badge>
      );
    }
    if (score >= 0.6) {
      return (
        <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200 text-xs">
          Medium
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-xs">
        Low
      </Badge>
    );
  };

  const getStatusBadge = (item: AssetLineItem) => {
    switch (item.importStatus) {
      case 'imported':
        return (
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-xs">
            <CheckCircle className="h-3 w-3 mr-1" />
            Imported
          </Badge>
        );
      case 'error':
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-xs">
                  <AlertCircle className="h-3 w-3 mr-1" />
                  Error
                </Badge>
              </TooltipTrigger>
              <TooltipContent className="max-w-[300px]">
                {item.errorMessage || 'Import failed'}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      case 'importing':
        return (
          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-xs">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            Importing
          </Badge>
        );
      default:
        if (item.purchaseCost <= 0) {
          return (
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-xs">
              <AlertCircle className="h-3 w-3 mr-1" />
              Needs price
            </Badge>
          );
        }
        return (
          <Badge variant="outline" className="text-xs">
            Ready
          </Badge>
        );
    }
  };

  const getRowBackground = (item: AssetLineItem) => {
    if (item.importStatus === 'imported') return 'bg-green-50/50 dark:bg-green-900/10';
    if (item.importStatus === 'error') return 'bg-red-50/50 dark:bg-red-900/10';
    if (item.importStatus === 'pending' && item.purchaseCost <= 0) return 'bg-amber-50/50 dark:bg-amber-900/10';
    return '';
  };

  return (
    <Card className="w-full max-w-full overflow-hidden">
      <CardHeader className="pb-4 px-4 sm:px-6">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <Package className="h-5 w-5 flex-shrink-0" />
              <span className="truncate">Review Extracted Assets</span>
            </CardTitle>
            <CardDescription className="text-sm">
              {stats.total} asset{stats.total !== 1 ? 's' : ''} • {formatAssetCurrency(stats.totalCost)}
            </CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel} aria-label="Close" className="flex-shrink-0">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {isImporting && importProgress && (
          <div className="mt-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span>Importing assets...</span>
              <span>{importProgress.current} of {importProgress.total}</span>
            </div>
            <Progress value={(importProgress.current / importProgress.total) * 100} className="h-2" />
          </div>
        )}
      </CardHeader>

      <CardContent className="p-0">
        {/* Mobile card view */}
        <div className="block sm:hidden divide-y">
          {items.map(item => {
            const isExpanded = expandedItems.has(item.id);
            return (
              <div key={item.id} className={`p-4 ${getRowBackground(item)}`}>
                {/* Main row - always visible */}
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0 space-y-2">
                    <Input
                      value={item.parsedName}
                      onChange={e => handleUpdateItem(item.id, { parsedName: e.target.value })}
                      disabled={item.importStatus !== 'pending' || isImporting}
                      className="h-9 text-sm font-medium"
                      placeholder="Asset name"
                    />
                    <div className="flex items-center gap-2 flex-wrap">
                      {getStatusBadge(item)}
                      {getConfidenceBadge(item.confidenceScore)}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <div className="relative w-24">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={item.purchaseCost || ''}
                        onChange={e => handleUpdateItem(item.id, { purchaseCost: parseFloat(e.target.value) || 0 })}
                        disabled={item.importStatus !== 'pending' || isImporting}
                        placeholder="0.00"
                        className={`h-9 text-sm text-right pl-6 ${
                          item.importStatus === 'pending' && item.purchaseCost <= 0
                            ? 'border-amber-400 focus:border-amber-500'
                            : ''
                        }`}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleExpanded(item.id)}
                      className="h-7 px-2 text-xs text-muted-foreground"
                    >
                      {isExpanded ? (
                        <>Less <ChevronUp className="h-3 w-3 ml-1" /></>
                      ) : (
                        <>More <ChevronDown className="h-3 w-3 ml-1" /></>
                      )}
                    </Button>
                  </div>
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="mt-3 pt-3 border-t space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Category</label>
                        <Select
                          value={item.category}
                          onValueChange={value => {
                            const cat = DEFAULT_ASSET_CATEGORIES.find(c => c.name === value);
                            handleUpdateItem(item.id, {
                              category: value,
                              usefulLifeMonths: cat?.default_useful_life_months || item.usefulLifeMonths,
                            });
                          }}
                          disabled={item.importStatus !== 'pending' || isImporting}
                        >
                          <SelectTrigger className="h-9 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {DEFAULT_ASSET_CATEGORIES.map(cat => (
                              <SelectItem key={cat.name} value={cat.name}>{cat.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Purchase Date</label>
                        <Input
                          type="date"
                          value={item.purchaseDate}
                          onChange={e => handleUpdateItem(item.id, { purchaseDate: e.target.value })}
                          disabled={item.importStatus !== 'pending' || isImporting}
                          className="h-9 text-sm"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Useful Life</label>
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            min="1"
                            value={item.usefulLifeMonths}
                            onChange={e => handleUpdateItem(item.id, { usefulLifeMonths: parseInt(e.target.value) || 60 })}
                            disabled={item.importStatus !== 'pending' || isImporting}
                            className="h-9 text-sm"
                          />
                          <span className="text-xs text-muted-foreground">mo</span>
                        </div>
                      </div>
                      <div className="flex items-end">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRemoveItem(item.id)}
                          disabled={item.importStatus !== 'pending' || isImporting}
                          className="w-full h-9 text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          Remove
                        </Button>
                      </div>
                    </div>
                    {item.serialNumber && (
                      <p className="text-xs text-muted-foreground">S/N: {item.serialNumber}</p>
                    )}
                    {item.category !== item.suggestedCategory && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Sparkles className="h-3 w-3" />
                        AI suggested: {item.suggestedCategory}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Desktop table view */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-3 font-medium">Asset Name</th>
                <th className="text-left p-3 font-medium">Category</th>
                <th className="text-left p-3 font-medium hidden lg:table-cell">Date</th>
                <th className="text-right p-3 font-medium">Cost</th>
                <th className="text-right p-3 font-medium hidden md:table-cell">Life</th>
                <th className="text-center p-3 font-medium hidden lg:table-cell">Confidence</th>
                <th className="text-left p-3 font-medium">Status</th>
                <th className="text-right p-3 font-medium w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map(item => (
                <tr key={item.id} className={getRowBackground(item)}>
                  <td className="p-3">
                    <div className="space-y-1">
                      <Input
                        value={item.parsedName}
                        onChange={e => handleUpdateItem(item.id, { parsedName: e.target.value })}
                        disabled={item.importStatus !== 'pending' || isImporting}
                        className="h-8 text-sm font-medium min-w-[150px]"
                      />
                      {item.serialNumber && (
                        <span className="text-xs text-muted-foreground">S/N: {item.serialNumber}</span>
                      )}
                    </div>
                  </td>
                  <td className="p-3">
                    <Select
                      value={item.category}
                      onValueChange={value => {
                        const cat = DEFAULT_ASSET_CATEGORIES.find(c => c.name === value);
                        handleUpdateItem(item.id, {
                          category: value,
                          usefulLifeMonths: cat?.default_useful_life_months || item.usefulLifeMonths,
                        });
                      }}
                      disabled={item.importStatus !== 'pending' || isImporting}
                    >
                      <SelectTrigger className="h-8 text-sm min-w-[120px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DEFAULT_ASSET_CATEGORIES.map(cat => (
                          <SelectItem key={cat.name} value={cat.name}>{cat.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="p-3 hidden lg:table-cell">
                    <Input
                      type="date"
                      value={item.purchaseDate}
                      onChange={e => handleUpdateItem(item.id, { purchaseDate: e.target.value })}
                      disabled={item.importStatus !== 'pending' || isImporting}
                      className="h-8 text-sm w-[130px]"
                    />
                  </td>
                  <td className="p-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <span className="text-muted-foreground">$</span>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={item.purchaseCost || ''}
                        onChange={e => handleUpdateItem(item.id, { purchaseCost: parseFloat(e.target.value) || 0 })}
                        disabled={item.importStatus !== 'pending' || isImporting}
                        placeholder="0.00"
                        className={`h-8 text-sm text-right w-24 ${
                          item.importStatus === 'pending' && item.purchaseCost <= 0
                            ? 'border-amber-400 focus:border-amber-500'
                            : ''
                        }`}
                      />
                      {item.importStatus === 'pending' && item.purchaseCost <= 0 && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <AlertCircle className="h-4 w-4 text-amber-500 flex-shrink-0" />
                            </TooltipTrigger>
                            <TooltipContent>Enter a cost {'>'} $0 to import</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                  </td>
                  <td className="p-3 text-right hidden md:table-cell">
                    <div className="flex items-center gap-1 justify-end">
                      <Input
                        type="number"
                        min="1"
                        value={item.usefulLifeMonths}
                        onChange={e => handleUpdateItem(item.id, { usefulLifeMonths: parseInt(e.target.value) || 60 })}
                        disabled={item.importStatus !== 'pending' || isImporting}
                        className="h-8 text-sm text-right w-16"
                      />
                      <span className="text-xs text-muted-foreground">mo</span>
                    </div>
                  </td>
                  <td className="p-3 text-center hidden lg:table-cell">
                    {getConfidenceBadge(item.confidenceScore)}
                  </td>
                  <td className="p-3">
                    {getStatusBadge(item)}
                  </td>
                  <td className="p-3 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveItem(item.id)}
                      disabled={item.importStatus !== 'pending' || isImporting}
                      aria-label="Remove asset"
                      className="h-8 w-8"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {items.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No assets to import</p>
          </div>
        )}
      </CardContent>

      <Separator />

      <CardFooter className="flex flex-col gap-3 p-4 sm:px-6">
        {stats.needsPrice > 0 && (
          <div className="w-full bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md p-3 text-sm">
            <span className="text-amber-700 dark:text-amber-300 font-medium">
              {stats.needsPrice} item{stats.needsPrice !== 1 ? 's need' : ' needs'} a price
            </span>
            <span className="text-amber-600 dark:text-amber-400 ml-1 hidden sm:inline">
              — Enter a cost {'>'} $0 or remove the row to import
            </span>
          </div>
        )}

        {/* Mobile: stack vertically */}
        <div className="w-full flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
            {stats.readyToImport > 0 && (
              <span className="text-green-600">{stats.readyToImport} ready</span>
            )}
            {stats.needsPrice > 0 && (
              <span className="text-amber-600">{stats.needsPrice} need price</span>
            )}
            {stats.imported > 0 && (
              <span className="text-green-600">{stats.imported} imported</span>
            )}
            {stats.errored > 0 && (
              <span className="text-red-600">{stats.errored} failed</span>
            )}
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <Button variant="outline" onClick={onCancel} disabled={isImporting} className="flex-1 sm:flex-initial">
              Cancel
            </Button>
            <Button
              onClick={handleImport}
              disabled={isImporting || stats.readyToImport === 0}
              className="flex-1 sm:flex-initial"
            >
              {isImporting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Import {stats.readyToImport} Asset{stats.readyToImport !== 1 ? 's' : ''}
            </Button>
          </div>
        </div>
      </CardFooter>
    </Card>
  );
}
