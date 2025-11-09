import React, { useState, useMemo } from 'react';
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
import { AlertCircle, CheckCircle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ColumnMapping {
  csvColumn: string;
  targetField: string | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
  isAdjustment?: boolean;
  adjustmentType?: 'tax' | 'tip' | 'service_charge' | 'discount' | 'fee';
}

export interface ColumnMappingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  csvHeaders: string[];
  sampleData: Record<string, string>[];
  suggestedMappings: ColumnMapping[];
  onConfirm: (mappings: ColumnMapping[]) => void;
}

// Target fields available for mapping
const TARGET_FIELDS = [
  { value: 'itemName', label: 'Item Name', required: true },
  { value: 'quantity', label: 'Quantity', required: false },
  { value: 'unitPrice', label: 'Unit Price', required: false },
  { value: 'totalPrice', label: 'Total Price', required: false },
  { value: 'saleDate', label: 'Sale Date', required: false },
  { value: 'saleTime', label: 'Sale Time', required: false },
  { value: 'orderId', label: 'Order ID', required: false },
  { value: 'category', label: 'Category', required: false },
  { value: 'department', label: 'Department', required: false },
  { value: 'grossSales', label: 'Gross Sales', required: false },
  { value: 'netSales', label: 'Net Sales', required: false },
  { value: 'discount', label: 'Discount Amount (creates adjustment)', required: false, isAdjustment: true, adjustmentType: 'discount' as const },
  { value: 'tax', label: 'Tax Amount (creates adjustment)', required: false, isAdjustment: true, adjustmentType: 'tax' as const },
  { value: 'tip', label: 'Tip Amount (creates adjustment)', required: false, isAdjustment: true, adjustmentType: 'tip' as const },
  { value: 'serviceCharge', label: 'Service Charge (creates adjustment)', required: false, isAdjustment: true, adjustmentType: 'service_charge' as const },
  { value: 'fee', label: 'Fee (creates adjustment)', required: false, isAdjustment: true, adjustmentType: 'fee' as const },
  { value: 'ignore', label: '(Ignore this column)', required: false },
];

export const ColumnMappingDialog: React.FC<ColumnMappingDialogProps> = ({
  open,
  onOpenChange,
  csvHeaders,
  sampleData,
  suggestedMappings,
  onConfirm,
}) => {
  const [mappings, setMappings] = useState<ColumnMapping[]>(suggestedMappings);

  // Update mappings when suggestions change
  React.useEffect(() => {
    setMappings(suggestedMappings);
  }, [suggestedMappings]);

  const handleMappingChange = (csvColumn: string, targetField: string | null) => {
    setMappings(prev =>
      prev.map(m => {
        if (m.csvColumn === csvColumn) {
          const targetFieldDef = TARGET_FIELDS.find(f => f.value === targetField);
          return {
            ...m,
            targetField,
            isAdjustment: targetFieldDef?.isAdjustment,
            adjustmentType: targetFieldDef?.adjustmentType,
            confidence: targetField ? 'high' : 'none',
          };
        }
        return m;
      })
    );
  };

  const validation = useMemo(() => {
    const hasItemName = mappings.some(m => m.targetField === 'itemName');
    const hasPrice = mappings.some(m => 
      m.targetField === 'totalPrice' || 
      m.targetField === 'unitPrice' || 
      m.targetField === 'grossSales' ||
      m.targetField === 'netSales'
    );
    const duplicates = mappings
      .filter(m => m.targetField && m.targetField !== 'ignore')
      .reduce((acc, m) => {
        const existing = acc.find(a => a.targetField === m.targetField && !TARGET_FIELDS.find(f => f.value === m.targetField)?.isAdjustment);
        if (existing && !TARGET_FIELDS.find(f => f.value === m.targetField)?.isAdjustment) {
          existing.count++;
        } else if (!TARGET_FIELDS.find(f => f.value === m.targetField)?.isAdjustment) {
          acc.push({ targetField: m.targetField!, count: 1 });
        }
        return acc;
      }, [] as Array<{ targetField: string; count: number }>)
      .filter(d => d.count > 1);

    return {
      isValid: hasItemName && hasPrice && duplicates.length === 0,
      errors: [
        !hasItemName && 'Item Name is required - please map at least one column to Item Name',
        !hasPrice && 'Price information is required - please map to Total Price, Unit Price, Gross Sales, or Net Sales',
        duplicates.length > 0 && `Duplicate mappings found: ${duplicates.map(d => d.targetField).join(', ')}`,
      ].filter(Boolean) as string[],
    };
  }, [mappings]);

  const adjustmentMappings = mappings.filter(m => m.isAdjustment && m.targetField !== 'ignore');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Map CSV Columns</DialogTitle>
          <DialogDescription>
            Review and adjust how your CSV columns map to our system fields.
            We've suggested mappings based on common patterns, but you can customize them below.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!validation.isValid && (
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

          {adjustmentMappings.length > 0 && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                <p className="font-medium mb-1">Adjustment columns detected</p>
                <p className="text-sm">
                  The following columns will create separate adjustment entries (tax, tip, discount, etc.):
                  {' '}
                  <span className="font-mono text-xs">
                    {adjustmentMappings.map(m => m.csvColumn).join(', ')}
                  </span>
                </p>
              </AlertDescription>
            </Alert>
          )}

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[200px]">CSV Column</TableHead>
                  <TableHead className="w-[250px]">Maps To</TableHead>
                  <TableHead>Sample Data</TableHead>
                  <TableHead className="w-[100px]">Confidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mappings.map((mapping) => {
                  const sampleValues = sampleData
                    .slice(0, 3)
                    .map(row => row[mapping.csvColumn])
                    .filter(v => v && v.trim());
                  
                  const selectedField = TARGET_FIELDS.find(f => f.value === mapping.targetField);

                  return (
                    <TableRow key={mapping.csvColumn}>
                      <TableCell className="font-medium font-mono text-sm">
                        {mapping.csvColumn}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={mapping.targetField || 'ignore'}
                          onValueChange={(value) => 
                            handleMappingChange(mapping.csvColumn, value === 'ignore' ? null : value)
                          }
                        >
                          <SelectTrigger className={cn(
                            selectedField?.required && 'border-primary'
                          )}>
                            <SelectValue placeholder="Select field..." />
                          </SelectTrigger>
                          <SelectContent>
                            {TARGET_FIELDS.map((field) => (
                              <SelectItem key={field.value} value={field.value}>
                                <div className="flex items-center gap-2">
                                  <span>{field.label}</span>
                                  {field.required && (
                                    <Badge variant="destructive" className="text-xs">Required</Badge>
                                  )}
                                  {field.isAdjustment && (
                                    <Badge variant="outline" className="text-xs">Adjustment</Badge>
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
                                {value.length > 30 ? `${value.substring(0, 30)}...` : value}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-muted-foreground text-sm italic">(empty)</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {mapping.confidence !== 'none' ? (
                          <Badge 
                            variant={
                              mapping.confidence === 'high' ? 'default' : 
                              mapping.confidence === 'medium' ? 'outline' : 
                              'secondary'
                            }
                            className={cn(
                              mapping.confidence === 'high' && 'bg-green-500',
                              mapping.confidence === 'medium' && 'bg-yellow-500 text-black',
                            )}
                          >
                            {mapping.confidence === 'high' && <CheckCircle className="w-3 h-3 mr-1" />}
                            {mapping.confidence}
                          </Badge>
                        ) : (
                          <Badge variant="secondary">none</Badge>
                        )}
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
              <p><strong>Tips:</strong></p>
              <ul className="list-disc list-inside space-y-1">
                <li>Use <strong>Gross Sales</strong> or <strong>Net Sales</strong> for total revenue per item</li>
                <li>Map <strong>Discounts</strong> column to "Discount Amount" to create discount adjustments automatically</li>
                <li>Columns marked as adjustments (tax, tip, discount) will create separate entries in your POS data</li>
                <li>You can ignore columns that contain summary data or aren't needed</li>
              </ul>
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(mappings)} disabled={!validation.isValid}>
            Continue with Mapping
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
