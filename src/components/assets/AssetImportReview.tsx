import { useState, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
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
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Loader2,
  Package,
  Sparkles,
  Trash2,
  X,
  DollarSign,
  Calendar,
  Clock,
  Hash,
  CheckCircle2,
} from 'lucide-react';
import { useAssetImport } from '@/hooks/useAssetImport';
import { DEFAULT_ASSET_CATEGORIES, formatAssetCurrency } from '@/types/assets';
import type { AssetLineItem } from '@/types/assetImport';

interface AssetImportReviewProps {
  readonly initialItems: AssetLineItem[];
  readonly documentFile?: File;
  readonly onImportComplete: () => void;
  readonly onCancel: () => void;
}

export function AssetImportReview({
  initialItems,
  documentFile,
  onImportComplete,
  onCancel,
}: Readonly<AssetImportReviewProps>) {
  const [items, setItems] = useState<AssetLineItem[]>(initialItems);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const { bulkImportAssets, isImporting, importProgress } = useAssetImport();

  // Calculated stats
  const stats = useMemo(() => {
    const pending = items.filter(i => i.importStatus === 'pending').length;
    const imported = items.filter(i => i.importStatus === 'imported').length;
    const errored = items.filter(i => i.importStatus === 'error').length;
    const totalCost = items.reduce((sum, i) => sum + (i.unitCost * (i.quantity || 1)), 0);
    const totalUnits = items.reduce((sum, i) => sum + (i.quantity || 1), 0);
    const needsPrice = items.filter(i => i.importStatus === 'pending' && i.unitCost <= 0).length;
    const readyToImport = items.filter(i => i.importStatus === 'pending' && i.unitCost > 0).length;

    return { pending, imported, errored, totalCost, totalUnits, total: items.length, needsPrice, readyToImport };
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
    const pendingItems = items.filter(i => i.importStatus === 'pending' && i.unitCost > 0);
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
        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800 text-[10px] font-medium">
          High
        </Badge>
      );
    }
    if (score >= 0.6) {
      return (
        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800 text-[10px] font-medium">
          Medium
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800 text-[10px] font-medium">
        Low
      </Badge>
    );
  };

  const getStatusBadge = (item: AssetLineItem) => {
    switch (item.importStatus) {
      case 'imported':
        return (
          <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-400 dark:border-emerald-800 text-[10px] font-medium gap-1">
            <CheckCircle2 className="h-3 w-3" />
            Imported
          </Badge>
        );
      case 'error':
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge className="bg-red-100 text-red-700 border-red-200 dark:bg-red-950/50 dark:text-red-400 dark:border-red-800 text-[10px] font-medium gap-1 cursor-help">
                  <AlertCircle className="h-3 w-3" />
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
          <Badge className="bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-400 dark:border-blue-800 text-[10px] font-medium gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            Importing
          </Badge>
        );
      default:
        if (item.unitCost <= 0) {
          return (
            <Badge className="bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-800 text-[10px] font-medium gap-1">
              <AlertTriangle className="h-3 w-3" />
              Needs price
            </Badge>
          );
        }
        return (
          <Badge variant="outline" className="text-[10px] font-medium gap-1 text-slate-600 dark:text-slate-400">
            <CheckCircle className="h-3 w-3" />
            Ready
          </Badge>
        );
    }
  };

  const getRowBackground = (item: AssetLineItem) => {
    if (item.importStatus === 'imported') return 'bg-emerald-50/60 dark:bg-emerald-950/20 border-l-2 border-l-emerald-500';
    if (item.importStatus === 'error') return 'bg-red-50/60 dark:bg-red-950/20 border-l-2 border-l-red-500';
    if (item.importStatus === 'pending' && item.unitCost <= 0) return 'bg-amber-50/60 dark:bg-amber-950/20 border-l-2 border-l-amber-500';
    return 'border-l-2 border-l-transparent hover:bg-slate-50 dark:hover:bg-slate-800/50';
  };

  return (
    <div className="space-y-3">
      {/* Header Row - Compact */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg shadow-blue-500/20">
            <Package className="h-4 w-4 text-white" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Review Extracted Assets
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {stats.total} asset{stats.total !== 1 ? 's' : ''} • {formatAssetCurrency(stats.totalCost)} total
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Inline Stats */}
          {stats.readyToImport > 0 && (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 text-[11px] font-medium">
              <CheckCircle className="h-3 w-3" />
              {stats.readyToImport} ready
            </div>
          )}
          {stats.needsPrice > 0 && (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 text-[11px] font-medium">
              <DollarSign className="h-3 w-3" />
              {stats.needsPrice} need price
            </div>
          )}
          {stats.imported > 0 && (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 text-[11px] font-medium">
              <CheckCircle2 className="h-3 w-3" />
              {stats.imported}
            </div>
          )}
          {stats.errored > 0 && (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400 text-[11px] font-medium">
              <AlertCircle className="h-3 w-3" />
              {stats.errored}
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={onCancel}
            aria-label="Close"
            className="h-8 w-8 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Import Progress - Compact */}
      {isImporting && importProgress && (
        <div className="rounded-lg p-3 border bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
          <div className="flex items-center gap-3 mb-2">
            <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />
            <div className="flex-1 flex justify-between text-sm">
              <span className="text-blue-700 dark:text-blue-300">Importing...</span>
              <span className="text-blue-600 dark:text-blue-400">{importProgress.current}/{importProgress.total}</span>
            </div>
          </div>
          <Progress value={(importProgress.current / importProgress.total) * 100} className="h-1.5" />
        </div>
      )}

      {/* Needs Price Warning - Compact inline */}
      {stats.needsPrice > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-sm">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
          <span className="text-amber-700 dark:text-amber-300">
            <strong>{stats.needsPrice}</strong> item{stats.needsPrice !== 1 ? 's need' : ' needs'} a price to import
          </span>
        </div>
      )}

      {/* Items List */}
      <div className="border rounded-xl overflow-hidden bg-white dark:bg-slate-900">
        {/* Mobile card view */}
        <div className="block sm:hidden divide-y divide-slate-100 dark:divide-slate-800">
          {items.map(item => {
            const isExpanded = expandedItems.has(item.id);
            return (
              <div key={item.id} className={`p-4 transition-colors ${getRowBackground(item)}`}>
                {/* Main row - always visible */}
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0 space-y-2">
                    <Input
                      value={item.parsedName}
                      onChange={e => handleUpdateItem(item.id, { parsedName: e.target.value })}
                      disabled={item.importStatus !== 'pending' || isImporting}
                      className="h-9 text-sm font-medium bg-white dark:bg-slate-800"
                      placeholder="Asset name"
                    />
                    <div className="flex items-center gap-2 flex-wrap">
                      {getStatusBadge(item)}
                      {getConfidenceBadge(item.confidenceScore)}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        value={item.quantity || 1}
                        onChange={e => {
                          const qty = parseInt(e.target.value) || 1;
                          handleUpdateItem(item.id, {
                            quantity: qty,
                            purchaseCost: item.unitCost * qty,
                          });
                        }}
                        disabled={item.importStatus !== 'pending' || isImporting}
                        className="h-9 text-sm text-center w-14 bg-white dark:bg-slate-800"
                        placeholder="Qty"
                      />
                      <span className="text-slate-400 text-sm">×</span>
                      <div className="relative w-24">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={item.unitCost || ''}
                          onChange={e => {
                            const cost = parseFloat(e.target.value) || 0;
                            handleUpdateItem(item.id, {
                              unitCost: cost,
                              purchaseCost: cost * (item.quantity || 1),
                            });
                          }}
                          disabled={item.importStatus !== 'pending' || isImporting}
                          placeholder="0.00"
                          className={`h-9 text-sm text-right pl-7 bg-white dark:bg-slate-800 ${
                            item.importStatus === 'pending' && item.unitCost <= 0
                              ? 'border-amber-400 ring-1 ring-amber-400/30 focus:border-amber-500 focus:ring-amber-500/30'
                              : ''
                          }`}
                        />
                      </div>
                    </div>
                    {(item.quantity || 1) > 1 && item.unitCost > 0 && (
                      <span className="text-xs text-slate-500">
                        Total: {formatAssetCurrency(item.unitCost * (item.quantity || 1))}
                      </span>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleExpanded(item.id)}
                      className="h-7 px-2 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
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
                  <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="flex items-center gap-1.5 text-xs text-slate-500 mb-1.5">
                          <Package className="h-3 w-3" />
                          Category
                        </label>
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
                          <SelectTrigger className="h-9 text-sm bg-white dark:bg-slate-800">
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
                        <label className="flex items-center gap-1.5 text-xs text-slate-500 mb-1.5">
                          <Calendar className="h-3 w-3" />
                          Purchase Date
                        </label>
                        <Input
                          type="date"
                          value={item.purchaseDate}
                          onChange={e => handleUpdateItem(item.id, { purchaseDate: e.target.value })}
                          disabled={item.importStatus !== 'pending' || isImporting}
                          className="h-9 text-sm bg-white dark:bg-slate-800"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="flex items-center gap-1.5 text-xs text-slate-500 mb-1.5">
                          <Clock className="h-3 w-3" />
                          Useful Life
                        </label>
                        <div className="flex items-center gap-1.5">
                          <Input
                            type="number"
                            min="1"
                            value={item.usefulLifeMonths}
                            onChange={e => handleUpdateItem(item.id, { usefulLifeMonths: parseInt(e.target.value) || 60 })}
                            disabled={item.importStatus !== 'pending' || isImporting}
                            className="h-9 text-sm bg-white dark:bg-slate-800"
                          />
                          <span className="text-xs text-slate-500 whitespace-nowrap">months</span>
                        </div>
                      </div>
                      <div className="flex items-end">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRemoveItem(item.id)}
                          disabled={item.importStatus !== 'pending' || isImporting}
                          className="w-full h-9 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30 border-red-200 dark:border-red-800"
                        >
                          <Trash2 className="h-4 w-4 mr-1.5" />
                          Remove
                        </Button>
                      </div>
                    </div>
                    {item.serialNumber && (
                      <div className="flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 dark:bg-slate-800 px-2 py-1.5 rounded">
                        <Hash className="h-3 w-3" />
                        S/N: <span className="font-mono text-slate-700 dark:text-slate-300">{item.serialNumber}</span>
                      </div>
                    )}
                    {item.category !== item.suggestedCategory && (
                      <button
                        type="button"
                        onClick={() => {
                          const cat = DEFAULT_ASSET_CATEGORIES.find(c => c.name === item.suggestedCategory);
                          handleUpdateItem(item.id, {
                            category: item.suggestedCategory,
                            usefulLifeMonths: cat?.default_useful_life_months || item.usefulLifeMonths,
                          });
                        }}
                        disabled={item.importStatus !== 'pending' || isImporting}
                        className="flex items-center gap-1.5 text-xs text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/30 px-2 py-1.5 rounded hover:bg-violet-100 dark:hover:bg-violet-900/50 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Sparkles className="h-3 w-3" />
                        Use AI suggestion: {item.suggestedCategory}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Desktop table view - compact for more rows visible */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800">
                <th className="text-left px-3 py-2 font-medium text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">Asset Name</th>
                <th className="text-left px-3 py-2 font-medium text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">Category</th>
                <th className="text-left px-3 py-2 font-medium text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide hidden lg:table-cell">Date</th>
                <th className="text-center px-3 py-2 font-medium text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide w-16">Qty</th>
                <th className="text-right px-3 py-2 font-medium text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">Unit Cost</th>
                <th className="text-right px-3 py-2 font-medium text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide hidden md:table-cell">Life</th>
                <th className="text-center px-3 py-2 font-medium text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide hidden xl:table-cell">Conf.</th>
                <th className="text-left px-3 py-2 font-medium text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">Status</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {items.map(item => (
                <tr key={item.id} className={`transition-colors ${getRowBackground(item)}`}>
                  <td className="px-3 py-1.5">
                    <Input
                      value={item.parsedName}
                      onChange={e => handleUpdateItem(item.id, { parsedName: e.target.value })}
                      disabled={item.importStatus !== 'pending' || isImporting}
                      className="h-7 text-sm font-medium min-w-[140px] bg-white dark:bg-slate-800"
                    />
                  </td>
                  <td className="px-3 py-1.5">
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
                      <SelectTrigger className="h-7 text-sm min-w-[120px] bg-white dark:bg-slate-800">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DEFAULT_ASSET_CATEGORIES.map(cat => (
                          <SelectItem key={cat.name} value={cat.name}>{cat.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-3 py-1.5 hidden lg:table-cell">
                    <Input
                      type="date"
                      value={item.purchaseDate}
                      onChange={e => handleUpdateItem(item.id, { purchaseDate: e.target.value })}
                      disabled={item.importStatus !== 'pending' || isImporting}
                      className="h-7 text-sm w-[130px] bg-white dark:bg-slate-800"
                    />
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      value={item.quantity || 1}
                      onChange={e => {
                        const qty = parseInt(e.target.value) || 1;
                        handleUpdateItem(item.id, {
                          quantity: qty,
                          purchaseCost: item.unitCost * qty,
                        });
                      }}
                      disabled={item.importStatus !== 'pending' || isImporting}
                      className="h-7 text-sm text-center w-14 bg-white dark:bg-slate-800"
                    />
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <div className="flex flex-col items-end gap-0.5">
                      <div className="flex items-center gap-1">
                        <span className="text-slate-400 text-xs">$</span>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={item.unitCost || ''}
                          onChange={e => {
                            const cost = parseFloat(e.target.value) || 0;
                            handleUpdateItem(item.id, {
                              unitCost: cost,
                              purchaseCost: cost * (item.quantity || 1),
                            });
                          }}
                          disabled={item.importStatus !== 'pending' || isImporting}
                          placeholder="0.00"
                          className={`h-7 text-sm text-right w-20 bg-white dark:bg-slate-800 ${
                            item.importStatus === 'pending' && item.unitCost <= 0
                              ? 'border-amber-400 ring-1 ring-amber-400/30 focus:border-amber-500 focus:ring-amber-500/30'
                              : ''
                          }`}
                        />
                        {item.importStatus === 'pending' && item.unitCost <= 0 && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="p-0.5 rounded bg-amber-100 dark:bg-amber-900/50">
                                  <AlertTriangle className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>Enter a unit cost {'>'} $0 to import</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                      {(item.quantity || 1) > 1 && item.unitCost > 0 && (
                        <span className="text-[10px] text-slate-500">
                          Total: {formatAssetCurrency(item.unitCost * (item.quantity || 1))}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-right hidden md:table-cell">
                    <div className="flex items-center gap-1 justify-end">
                      <Input
                        type="number"
                        min="1"
                        value={item.usefulLifeMonths}
                        onChange={e => handleUpdateItem(item.id, { usefulLifeMonths: parseInt(e.target.value) || 60 })}
                        disabled={item.importStatus !== 'pending' || isImporting}
                        className="h-7 text-sm text-right w-14 bg-white dark:bg-slate-800"
                      />
                      <span className="text-[10px] text-slate-400">mo</span>
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-center hidden xl:table-cell">
                    {getConfidenceBadge(item.confidenceScore)}
                  </td>
                  <td className="px-3 py-1.5">
                    {getStatusBadge(item)}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveItem(item.id)}
                      disabled={item.importStatus !== 'pending' || isImporting}
                      aria-label="Remove asset"
                      className="h-7 w-7 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {items.length === 0 && (
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 mb-3">
              <Package className="h-6 w-6 text-slate-400" />
            </div>
            <p className="text-slate-600 dark:text-slate-400 font-medium text-sm">No assets to import</p>
          </div>
        )}
      </div>

      {/* Footer Actions - Compact */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-1">
        <Button
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={isImporting}
          className="sm:w-auto"
        >
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleImport}
          disabled={isImporting || stats.readyToImport === 0}
          className="sm:w-auto bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 shadow-md shadow-blue-500/20"
        >
          {isImporting ? (
            <>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              Importing...
            </>
          ) : (
            <>
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
              Import {stats.readyToImport} Asset{stats.readyToImport !== 1 ? 's' : ''}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
