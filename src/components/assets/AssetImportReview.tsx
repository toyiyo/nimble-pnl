import React, { useState, useCallback, useMemo } from 'react';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertCircle,
  CheckCircle,
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

  const { bulkImportAssets, isImporting, importProgress } = useAssetImport();

  // Calculated stats
  const stats = useMemo(() => {
    const pending = items.filter(i => i.importStatus === 'pending').length;
    const imported = items.filter(i => i.importStatus === 'imported').length;
    const errored = items.filter(i => i.importStatus === 'error').length;
    const totalCost = items.reduce((sum, i) => sum + i.purchaseCost, 0);

    return { pending, imported, errored, totalCost, total: items.length };
  }, [items]);

  const handleUpdateItem = useCallback((id: string, updates: Partial<AssetLineItem>) => {
    setItems(prev => prev.map(item => (item.id === id ? { ...item, ...updates } : item)));
  }, []);

  const handleRemoveItem = useCallback((id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
  }, []);

  const handleImport = useCallback(async () => {
    const pendingItems = items.filter(i => i.importStatus === 'pending');
    if (pendingItems.length === 0) return;

    const result = await bulkImportAssets(pendingItems, documentFile);

    // Update local state with results
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
        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
          High
        </Badge>
      );
    }
    if (score >= 0.6) {
      return (
        <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
          Medium
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
        Low
      </Badge>
    );
  };

  const getStatusIcon = (status: AssetLineItem['importStatus']) => {
    switch (status) {
      case 'imported':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      case 'importing':
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      default:
        return null;
    }
  };

  return (
    <Card className="w-full">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Review Extracted Assets
            </CardTitle>
            <CardDescription>
              {stats.total} asset{stats.total !== 1 ? 's' : ''} found totaling{' '}
              {formatAssetCurrency(stats.totalCost)}
            </CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Import progress */}
        {isImporting && importProgress && (
          <div className="mt-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span>Importing assets...</span>
              <span>
                {importProgress.current} of {importProgress.total}
              </span>
            </div>
            <Progress
              value={(importProgress.current / importProgress.total) * 100}
              className="h-2"
            />
          </div>
        )}
      </CardHeader>

      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[25%]">Asset Name</TableHead>
                <TableHead className="w-[15%]">Category</TableHead>
                <TableHead className="w-[12%]">Purchase Date</TableHead>
                <TableHead className="w-[10%] text-right">Cost</TableHead>
                <TableHead className="w-[10%] text-right">Useful Life</TableHead>
                <TableHead className="w-[8%] text-center">Confidence</TableHead>
                <TableHead className="w-[10%]">Status</TableHead>
                <TableHead className="w-[10%] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map(item => (
                <TableRow
                  key={item.id}
                  className={
                    item.importStatus === 'imported'
                      ? 'bg-green-50/50 dark:bg-green-900/10'
                      : item.importStatus === 'error'
                      ? 'bg-red-50/50 dark:bg-red-900/10'
                      : ''
                  }
                >
                  <TableCell>
                    <div className="space-y-1">
                      <Input
                        value={item.parsedName}
                        onChange={e =>
                          handleUpdateItem(item.id, { parsedName: e.target.value })
                        }
                        disabled={item.importStatus !== 'pending' || isImporting}
                        className="h-8 text-sm font-medium"
                      />
                      {item.serialNumber && (
                        <span className="text-xs text-muted-foreground">
                          S/N: {item.serialNumber}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
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
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DEFAULT_ASSET_CATEGORIES.map(cat => (
                          <SelectItem key={cat.name} value={cat.name}>
                            {cat.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {item.category !== item.suggestedCategory && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                              <Sparkles className="h-3 w-3" />
                              AI suggested: {item.suggestedCategory}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            Click to use AI suggestion
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </TableCell>
                  <TableCell>
                    <Input
                      type="date"
                      value={item.purchaseDate}
                      onChange={e =>
                        handleUpdateItem(item.id, { purchaseDate: e.target.value })
                      }
                      disabled={item.importStatus !== 'pending' || isImporting}
                      className="h-8 text-sm"
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={item.purchaseCost}
                      onChange={e =>
                        handleUpdateItem(item.id, {
                          purchaseCost: parseFloat(e.target.value) || 0,
                        })
                      }
                      disabled={item.importStatus !== 'pending' || isImporting}
                      className="h-8 text-sm text-right"
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center gap-1 justify-end">
                      <Input
                        type="number"
                        min="1"
                        value={item.usefulLifeMonths}
                        onChange={e =>
                          handleUpdateItem(item.id, {
                            usefulLifeMonths: parseInt(e.target.value) || 60,
                          })
                        }
                        disabled={item.importStatus !== 'pending' || isImporting}
                        className="h-8 text-sm text-right w-16"
                      />
                      <span className="text-xs text-muted-foreground">mo</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    {getConfidenceBadge(item.confidenceScore)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {getStatusIcon(item.importStatus)}
                      {item.importStatus === 'error' && item.errorMessage && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-xs text-red-600 truncate max-w-[80px]">
                                {item.errorMessage}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-[300px]">
                              {item.errorMessage}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
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
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {items.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No assets to import</p>
          </div>
        )}
      </CardContent>

      <Separator />

      <CardFooter className="flex items-center justify-between py-4">
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          {stats.pending > 0 && (
            <span>{stats.pending} pending</span>
          )}
          {stats.imported > 0 && (
            <span className="text-green-600">{stats.imported} imported</span>
          )}
          {stats.errored > 0 && (
            <span className="text-red-600">{stats.errored} failed</span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={onCancel} disabled={isImporting}>
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={isImporting || stats.pending === 0}
          >
            {isImporting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Import {stats.pending} Asset{stats.pending !== 1 ? 's' : ''}
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}
