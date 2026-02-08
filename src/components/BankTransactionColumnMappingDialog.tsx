import React, { useState, useMemo, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { AlertCircle, CheckCircle, Info, Building2, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  BANK_TARGET_FIELDS,
  validateBankMappings,
  type BankColumnMapping,
  type ConfidenceLevel,
  type DetectedAccountInfo,
} from '@/utils/bankTransactionColumnMapping';

const TABLE_HEAD_CLASS = 'text-[12px] font-medium text-muted-foreground uppercase tracking-wider';

const CONFIDENCE_VARIANT_MAP: Record<Exclude<ConfidenceLevel, 'none'>, 'default' | 'outline' | 'secondary'> = {
  high: 'default',
  medium: 'outline',
  low: 'secondary',
};

interface ConnectedBank {
  id: string;
  institution_name: string;
  status: string;
}

export interface BankTransactionColumnMappingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  csvHeaders: string[];
  sampleData: Record<string, string>[];
  suggestedMappings: BankColumnMapping[];
  connectedBanks: ConnectedBank[];
  detectedAccountInfo?: DetectedAccountInfo;
  onConfirm: (
    mappings: BankColumnMapping[],
    selectedBankId: string,
    bankAccountName?: string
  ) => void;
}

export const BankTransactionColumnMappingDialog: React.FC<
  BankTransactionColumnMappingDialogProps
> = ({
  open,
  onOpenChange,
  csvHeaders,
  sampleData,
  suggestedMappings,
  connectedBanks,
  detectedAccountInfo,
  onConfirm,
}) => {
  const [mappings, setMappings] = useState<BankColumnMapping[]>(suggestedMappings);
  const [selectedBankId, setSelectedBankId] = useState<string>('');
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newBankName, setNewBankName] = useState(
    detectedAccountInfo?.institutionName || ''
  );

  // Update mappings when suggestions change
  useEffect(() => {
    setMappings(suggestedMappings);
  }, [suggestedMappings]);

  // Auto-select bank based on detected info
  useEffect(() => {
    const institutionName = detectedAccountInfo?.institutionName;
    if (institutionName && connectedBanks.length > 0) {
      const match = connectedBanks.find((b) =>
        b.institution_name.toLowerCase().includes(institutionName.toLowerCase())
      );
      if (match) {
        setSelectedBankId(match.id);
      }
    }
  }, [detectedAccountInfo, connectedBanks]);

  const handleMappingChange = (csvColumn: string, targetField: string | null) => {
    setMappings((prev) =>
      prev.map((m) => {
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

  const validation = useMemo(() => validateBankMappings(mappings), [mappings]);

  const hasBankSelection = selectedBankId || (isCreatingNew && newBankName.trim());

  const handleConfirm = () => {
    if (isCreatingNew && newBankName.trim()) {
      onConfirm(mappings, '__new__', newBankName.trim());
    } else if (selectedBankId) {
      onConfirm(mappings, selectedBankId);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto p-0 gap-0 border-border/40">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <Building2 className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">
                Map CSV Columns
              </DialogTitle>
              <p className="text-[13px] text-muted-foreground mt-0.5">
                Match your file's columns to transaction fields
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-5 space-y-5">
          {/* Bank Account Selector */}
          <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
            <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
              <h3 className="text-[13px] font-semibold text-foreground">
                Bank Account
              </h3>
            </div>
            <div className="p-4 space-y-3">
              {detectedAccountInfo?.institutionName && (
                <Alert className="border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20">
                  <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  <AlertDescription className="text-[13px] text-blue-700 dark:text-blue-300">
                    Detected: <strong>{detectedAccountInfo.institutionName}</strong>
                    {detectedAccountInfo.accountMask && (
                      <> (****{detectedAccountInfo.accountMask})</>
                    )}
                    {detectedAccountInfo.accountType && (
                      <> &mdash; {detectedAccountInfo.accountType}</>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              {isCreatingNew ? (
                <div className="space-y-2">
                  <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                    New Bank Account Name
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      value={newBankName}
                      onChange={(e) => setNewBankName(e.target.value)}
                      placeholder="e.g., Chase Checking ****1234"
                      className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-10 rounded-lg text-[13px]"
                      onClick={() => {
                        setIsCreatingNew(false);
                        setNewBankName('');
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                      Select Bank Account
                    </Label>
                    <Select
                      value={selectedBankId}
                      onValueChange={setSelectedBankId}
                    >
                      <SelectTrigger className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg mt-1.5">
                        <SelectValue placeholder="Choose a bank account..." />
                      </SelectTrigger>
                      <SelectContent>
                        {connectedBanks.map((bank) => (
                          <SelectItem key={bank.id} value={bank.id}>
                            {bank.institution_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-10 rounded-lg text-[13px]"
                      onClick={() => setIsCreatingNew(true)}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      New
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Validation Alerts */}
          {!validation.valid && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <ul className="list-disc list-inside space-y-1 text-[13px]">
                  {validation.errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {validation.warnings.length > 0 && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                <ul className="list-disc list-inside space-y-1 text-[13px]">
                  {validation.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Column Mapping Table */}
          <div className="rounded-xl border border-border/40 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className={cn(TABLE_HEAD_CLASS, 'w-[180px]')}>
                    CSV Column
                  </TableHead>
                  <TableHead className={cn(TABLE_HEAD_CLASS, 'w-[200px]')}>
                    Maps To
                  </TableHead>
                  <TableHead className={TABLE_HEAD_CLASS}>
                    Sample Data
                  </TableHead>
                  <TableHead className={cn(TABLE_HEAD_CLASS, 'w-[90px]')}>
                    Confidence
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mappings.map((mapping) => {
                  const sampleValues = sampleData
                    .slice(0, 3)
                    .map((row) => row[mapping.csvColumn])
                    .filter((v) => v?.trim());

                  return (
                    <TableRow key={mapping.csvColumn}>
                      <TableCell className="font-mono text-[13px] font-medium">
                        {mapping.csvColumn}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={mapping.targetField || 'ignore'}
                          onValueChange={(value) =>
                            handleMappingChange(
                              mapping.csvColumn,
                              value === 'ignore' ? null : value
                            )
                          }
                        >
                          <SelectTrigger className="h-9 text-[13px] bg-muted/30 border-border/40 rounded-lg">
                            <SelectValue placeholder="Select field..." />
                          </SelectTrigger>
                          <SelectContent>
                            {BANK_TARGET_FIELDS.map((field) => (
                              <SelectItem key={field.value} value={field.value}>
                                <div className="flex items-center gap-2">
                                  <span className="text-[13px]">{field.label}</span>
                                  {field.required && (
                                    <Badge
                                      variant="destructive"
                                      className="text-[10px] px-1 py-0"
                                    >
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
                              <Badge
                                key={`${mapping.csvColumn}-sample-${idx}`}
                                variant="outline"
                                className="font-mono text-[11px] bg-muted/30"
                              >
                                {value.length > 30
                                  ? `${value.substring(0, 30)}...`
                                  : value}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-[13px] text-muted-foreground italic">
                              (empty)
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {mapping.confidence === 'none' ? (
                          <Badge variant="secondary" className="text-[11px]">
                            none
                          </Badge>
                        ) : (
                          <Badge
                            variant={CONFIDENCE_VARIANT_MAP[mapping.confidence]}
                            className={cn(
                              'text-[11px]',
                              mapping.confidence === 'high' && 'bg-green-500',
                              mapping.confidence === 'medium' &&
                                'bg-yellow-500 text-black'
                            )}
                          >
                            {mapping.confidence === 'high' && (
                              <CheckCircle className="w-3 h-3 mr-1" />
                            )}
                            {mapping.confidence}
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Tips */}
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-[13px] space-y-1">
              <p className="font-medium">Tips:</p>
              <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
                <li>
                  If your file has separate <strong>Debit</strong> and{' '}
                  <strong>Credit</strong> columns, map both instead of Amount
                </li>
                <li>
                  If your file has a single <strong>Amount</strong> column (negative
                  = debits), map just that
                </li>
                <li>Columns you don't need can be left as "(Ignore this column)"</li>
              </ul>
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter className="px-6 py-4 border-t border-border/40">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-9 rounded-lg text-[13px] font-medium"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!validation.valid || !hasBankSelection}
            className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
          >
            Continue with Mapping
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
