import { useState, useMemo, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  Columns,
  Info,
  Sparkles,
  X,
  ArrowRight,
  FileSpreadsheet,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ASSET_TARGET_FIELDS,
  validateAssetMappings,
} from '@/utils/assetColumnMapping';
import type { AssetColumnMapping } from '@/utils/assetColumnMapping';

type ConfidenceLevel = 'high' | 'medium' | 'low' | 'none';

function getConfidenceStyles(confidence: ConfidenceLevel) {
  switch (confidence) {
    case 'high':
      return {
        bg: 'bg-emerald-100 dark:bg-emerald-950/50',
        text: 'text-emerald-700 dark:text-emerald-400',
        border: 'border-emerald-200 dark:border-emerald-800',
        icon: CheckCircle2,
      };
    case 'medium':
      return {
        bg: 'bg-amber-100 dark:bg-amber-950/50',
        text: 'text-amber-700 dark:text-amber-400',
        border: 'border-amber-200 dark:border-amber-800',
        icon: Check,
      };
    case 'low':
      return {
        bg: 'bg-orange-100 dark:bg-orange-950/50',
        text: 'text-orange-700 dark:text-orange-400',
        border: 'border-orange-200 dark:border-orange-800',
        icon: AlertTriangle,
      };
    default:
      return {
        bg: 'bg-slate-100 dark:bg-slate-800',
        text: 'text-slate-500 dark:text-slate-400',
        border: 'border-slate-200 dark:border-slate-700',
        icon: X,
      };
  }
}

function ConfidenceIndicator({ confidence }: { confidence: ConfidenceLevel }) {
  const styles = getConfidenceStyles(confidence);
  const Icon = styles.icon;

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wide',
        styles.bg,
        styles.text
      )}
    >
      <Icon className="h-3 w-3" />
      {confidence}
    </div>
  );
}

interface AssetColumnMappingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  csvHeaders: string[];
  sampleData: Record<string, string>[];
  suggestedMappings: AssetColumnMapping[];
  onConfirm: (mappings: AssetColumnMapping[]) => void;
}

export function AssetColumnMappingDialog({
  open,
  onOpenChange,
  sampleData,
  suggestedMappings,
  onConfirm,
}: AssetColumnMappingDialogProps): JSX.Element {
  const [mappings, setMappings] = useState<AssetColumnMapping[]>(suggestedMappings);

  useEffect(() => {
    setMappings(suggestedMappings);
  }, [suggestedMappings]);

  const handleMappingChange = (csvColumn: string, targetField: string | null) => {
    setMappings(prev =>
      prev.map(m => {
        if (m.csvColumn === csvColumn) {
          return {
            ...m,
            targetField,
            confidence: targetField ? 'high' as ConfidenceLevel : 'none' as ConfidenceLevel,
          };
        }
        return m;
      })
    );
  };

  const validation = useMemo(() => {
    const result = validateAssetMappings(mappings);

    const duplicates = mappings
      .filter(m => m.targetField && m.targetField !== 'ignore')
      .reduce((acc, m) => {
        const existing = acc.find(a => a.targetField === m.targetField);
        if (existing) {
          existing.count++;
        } else {
          acc.push({ targetField: m.targetField!, count: 1 });
        }
        return acc;
      }, [] as Array<{ targetField: string; count: number }>)
      .filter(d => d.count > 1);

    if (duplicates.length > 0) {
      result.errors.push(`Duplicate mappings: ${duplicates.map(d => d.targetField).join(', ')}`);
      result.valid = false;
    }

    return result;
  }, [mappings]);

  const autoMappedCount = suggestedMappings.filter(
    m => m.confidence === 'high' || m.confidence === 'medium'
  ).length;

  const mappedCount = mappings.filter(m => m.targetField && m.targetField !== 'ignore').length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col p-0">
        {/* Header */}
        <div className="relative px-6 pt-6 pb-4 border-b bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 shadow-lg shadow-indigo-500/20">
                <Columns className="h-5 w-5 text-white" />
              </div>
              <div>
                <DialogTitle className="text-lg font-semibold">Map CSV Columns</DialogTitle>
                <DialogDescription className="text-sm mt-0.5">
                  Match your spreadsheet columns to asset fields
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {/* Stats Pills */}
          <div className="flex flex-wrap gap-2 mt-4">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white dark:bg-slate-800 border shadow-sm text-sm">
              <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
              <span className="text-slate-600 dark:text-slate-300">
                <span className="font-semibold text-indigo-600 dark:text-indigo-400">{autoMappedCount}</span> auto-detected
              </span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white dark:bg-slate-800 border shadow-sm text-sm">
              <FileSpreadsheet className="h-3.5 w-3.5 text-slate-400" />
              <span className="text-slate-600 dark:text-slate-300">
                <span className="font-semibold">{mappedCount}</span> of {suggestedMappings.length} mapped
              </span>
            </div>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Error/Warning Alerts */}
          {!validation.valid && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-red-700 dark:text-red-300">
                  {validation.errors.map((error, idx) => (
                    <p key={idx}>{error}</p>
                  ))}
                </div>
              </div>
            </div>
          )}

          {validation.warnings.length > 0 && (
            <div className="mb-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-amber-700 dark:text-amber-300">
                  {validation.warnings.map((warning, idx) => (
                    <p key={idx}>{warning}</p>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Mapping Cards */}
          <div className="space-y-2">
            {mappings.map(mapping => {
              const sampleValues = sampleData
                .slice(0, 3)
                .map(row => row[mapping.csvColumn])
                .filter(v => v && v.trim());

              const selectedField = ASSET_TARGET_FIELDS.find(
                f => f.value === mapping.targetField
              );

              const isRequired = selectedField?.required;
              const isMapped = mapping.targetField && mapping.targetField !== 'ignore';

              return (
                <div
                  key={mapping.csvColumn}
                  className={cn(
                    'group rounded-xl border-2 transition-all duration-200',
                    isMapped
                      ? 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'
                      : 'border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30'
                  )}
                >
                  <div className="p-4">
                    {/* Mobile: Stacked layout, Desktop: Row layout */}
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      {/* CSV Column */}
                      <div className="flex items-center gap-2 sm:w-44 flex-shrink-0">
                        <div className="p-1.5 rounded bg-slate-100 dark:bg-slate-800">
                          <FileSpreadsheet className="h-3.5 w-3.5 text-slate-500" />
                        </div>
                        <span className="font-mono text-sm font-medium text-slate-700 dark:text-slate-300 truncate">
                          {mapping.csvColumn}
                        </span>
                      </div>

                      {/* Arrow */}
                      <ArrowRight className="hidden sm:block h-4 w-4 text-slate-300 dark:text-slate-600 flex-shrink-0" />

                      {/* Target Field Select */}
                      <div className="flex-1 min-w-0">
                        <Select
                          value={mapping.targetField || 'ignore'}
                          onValueChange={value =>
                            handleMappingChange(mapping.csvColumn, value === 'ignore' ? null : value)
                          }
                        >
                          <SelectTrigger
                            className={cn(
                              'h-10 bg-white dark:bg-slate-800 transition-all',
                              isRequired && 'ring-2 ring-indigo-500/20 border-indigo-300 dark:border-indigo-700',
                              !isMapped && 'border-dashed'
                            )}
                          >
                            <SelectValue placeholder="Select field..." />
                          </SelectTrigger>
                          <SelectContent>
                            {ASSET_TARGET_FIELDS.map(field => (
                              <SelectItem key={field.value} value={field.value}>
                                <div className="flex items-center gap-2">
                                  <span>{field.label}</span>
                                  {field.required && (
                                    <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400">
                                      Required
                                    </span>
                                  )}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Confidence */}
                      <div className="flex items-center gap-2 sm:w-24 flex-shrink-0 justify-between sm:justify-end">
                        <span className="text-xs text-slate-400 sm:hidden">Confidence:</span>
                        <ConfidenceIndicator confidence={mapping.confidence} />
                      </div>
                    </div>

                    {/* Sample Data */}
                    {sampleValues.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                        <div className="flex items-start gap-2">
                          <span className="text-[10px] uppercase tracking-wide text-slate-400 font-medium mt-0.5">
                            Preview
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {sampleValues.map((value, idx) => (
                              <Badge
                                key={idx}
                                variant="outline"
                                className="font-mono text-[11px] bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 max-w-[200px] truncate"
                              >
                                {value.length > 30 ? `${value.substring(0, 30)}...` : value}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Help Section */}
          <div className="mt-6 p-4 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900">
            <div className="flex items-start gap-3">
              <div className="p-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-900/50">
                <Info className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div className="text-sm space-y-2">
                <p className="font-medium text-indigo-900 dark:text-indigo-200">
                  Required: Asset Name, Purchase Date, and Purchase Cost
                </p>
                <ul className="text-indigo-700/80 dark:text-indigo-300/80 space-y-1">
                  <li className="flex items-center gap-1.5">
                    <ChevronRight className="h-3 w-3" />
                    <strong>Category</strong> determines the default depreciation schedule
                  </li>
                  <li className="flex items-center gap-1.5">
                    <ChevronRight className="h-3 w-3" />
                    <strong>Useful Life</strong> overrides category defaults for depreciation
                  </li>
                  <li className="flex items-center gap-1.5">
                    <ChevronRight className="h-3 w-3" />
                    Columns set to "Ignore" will not be imported
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3 px-6 py-4 border-t bg-slate-50/50 dark:bg-slate-900/50">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="sm:w-auto"
          >
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm(mappings)}
            disabled={!validation.valid}
            className="sm:w-auto bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 shadow-lg shadow-indigo-500/20"
          >
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Continue with {mappedCount} Fields
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
