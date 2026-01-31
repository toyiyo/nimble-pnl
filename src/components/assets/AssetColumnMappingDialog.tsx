import { useState, useMemo, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
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
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, CheckCircle, Info, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ASSET_TARGET_FIELDS,
  validateAssetMappings,
} from '@/utils/assetColumnMapping';
import type { AssetColumnMapping } from '@/utils/assetColumnMapping';

type ConfidenceLevel = 'high' | 'medium' | 'low' | 'none';

function getConfidenceBadgeVariant(confidence: ConfidenceLevel): 'default' | 'outline' | 'secondary' {
  switch (confidence) {
    case 'high':
      return 'default';
    case 'medium':
      return 'outline';
    default:
      return 'secondary';
  }
}

function getConfidenceBadgeClassName(confidence: ConfidenceLevel): string {
  switch (confidence) {
    case 'high':
      return 'bg-green-500';
    case 'medium':
      return 'bg-yellow-500 text-black';
    default:
      return '';
  }
}

function ConfidenceBadge({ confidence }: { confidence: ConfidenceLevel }): JSX.Element {
  if (confidence === 'none') {
    return <Badge variant="secondary">none</Badge>;
  }

  return (
    <Badge
      variant={getConfidenceBadgeVariant(confidence)}
      className={getConfidenceBadgeClassName(confidence)}
    >
      {confidence === 'high' && <CheckCircle className="w-3 h-3 mr-1" />}
      {confidence}
    </Badge>
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

  // Update mappings when suggestions change
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
            confidence: targetField ? 'high' : 'none',
          };
        }
        return m;
      })
    );
  };

  const validation = useMemo(() => {
    const result = validateAssetMappings(mappings);

    // Also check for duplicates
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
      result.errors.push(`Duplicate mappings found: ${duplicates.map(d => d.targetField).join(', ')}`);
      result.valid = false;
    }

    return result;
  }, [mappings]);

  // Count high-confidence auto-mapped fields
  const autoMappedCount = suggestedMappings.filter(
    m => m.confidence === 'high' || m.confidence === 'medium'
  ).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Map CSV Columns to Asset Fields
          </DialogTitle>
          <DialogDescription>
            We've automatically detected {autoMappedCount} of {suggestedMappings.length} columns.
            Review and adjust the mappings below before importing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!validation.valid && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <ul className="list-disc list-inside space-y-1">
                  {validation.errors.map((error, idx) => (
                    <li key={idx}>{error}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {validation.warnings.length > 0 && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                <ul className="list-disc list-inside space-y-1">
                  {validation.warnings.map((warning, idx) => (
                    <li key={idx}>{warning}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[200px]">CSV Column</TableHead>
                  <TableHead className="w-[220px]">Maps To</TableHead>
                  <TableHead>Sample Data</TableHead>
                  <TableHead className="w-[100px]">Confidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mappings.map(mapping => {
                  const sampleValues = sampleData
                    .slice(0, 3)
                    .map(row => row[mapping.csvColumn])
                    .filter(v => v && v.trim());

                  const selectedField = ASSET_TARGET_FIELDS.find(
                    f => f.value === mapping.targetField
                  );

                  return (
                    <TableRow key={mapping.csvColumn}>
                      <TableCell className="font-medium font-mono text-sm">
                        {mapping.csvColumn}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={mapping.targetField || 'ignore'}
                          onValueChange={value =>
                            handleMappingChange(mapping.csvColumn, value === 'ignore' ? null : value)
                          }
                        >
                          <SelectTrigger
                            className={cn(selectedField?.required && 'border-primary')}
                          >
                            <SelectValue placeholder="Select field..." />
                          </SelectTrigger>
                          <SelectContent>
                            {ASSET_TARGET_FIELDS.map(field => (
                              <SelectItem key={field.value} value={field.value}>
                                <div className="flex items-center gap-2">
                                  <span>{field.label}</span>
                                  {field.required && (
                                    <Badge variant="destructive" className="text-xs">
                                      Required
                                    </Badge>
                                  )}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {sampleValues.length > 0 ? (
                            sampleValues.map((value, idx) => (
                              <Badge key={idx} variant="outline" className="font-mono text-xs">
                                {value.length > 25 ? `${value.substring(0, 25)}...` : value}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-muted-foreground text-sm italic">(empty)</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <ConfidenceBadge confidence={mapping.confidence} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-sm space-y-2">
              <p>
                <strong>Required fields:</strong> Asset Name, Purchase Date, and Purchase Cost
              </p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>
                  <strong>Category</strong> helps determine the default depreciation schedule
                </li>
                <li>
                  <strong>Useful Life</strong> overrides the category default for depreciation
                </li>
                <li>
                  <strong>Salvage Value</strong> is used in depreciation calculations (defaults to
                  $0)
                </li>
                <li>Columns marked as "Ignore" will not be imported</li>
              </ul>
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(mappings)} disabled={!validation.valid}>
            Continue with Mapping
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
