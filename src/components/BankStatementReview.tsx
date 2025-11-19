import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useBankStatementImport, isLineImportable, type BankStatementLine, type BankStatementUpload } from '@/hooks/useBankStatementImport';
import { FileText, Check, Edit, Trash2, DollarSign, Calendar, Building2, Loader2, AlertCircle, AlertTriangle, X, Plus } from 'lucide-react';
import { format } from 'date-fns';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from '@/lib/utils';

interface BankStatementReviewProps {
  statementUploadId: string;
  onImportComplete: () => void;
}

export const BankStatementReview: React.FC<BankStatementReviewProps> = ({
  statementUploadId,
  onImportComplete,
}) => {
  const [lines, setLines] = useState<BankStatementLine[]>([]);
  const [statement, setStatement] = useState<BankStatementUpload | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    transaction_date: string | null;
    description: string;
    amount: number | null;
  } | null>(null);

  const {
    getBankStatementDetails,
    getBankStatementLines,
    updateStatementLine,
    toggleLineExclusion,
    importStatementLines,
  } = useBankStatementImport();

  const loadStatementData = async () => {
    setLoading(true);
    const [statementData, linesData] = await Promise.all([
      getBankStatementDetails(statementUploadId),
      getBankStatementLines(statementUploadId),
    ]);
    setStatement(statementData);
    setLines(linesData);
    setLoading(false);
  };

  useEffect(() => {
    loadStatementData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statementUploadId]);

  const handleEdit = (line: BankStatementLine) => {
    setEditingLineId(line.id);
    setEditForm({
      transaction_date: line.transaction_date,
      description: line.description,
      amount: line.amount,
    });
  };

  const handleSaveEdit = async () => {
    if (!editingLineId || !editForm) return;

    // Validate required fields before saving
    if (!editForm.transaction_date || !editForm.description || editForm.amount === null) {
      return; // Don't save if validation fails - keep in edit mode
    }

    const success = await updateStatementLine(editingLineId, editForm);
    if (success) {
      setEditingLineId(null);
      setEditForm(null);
      loadStatementData();
    }
  };

  const handleCancelEdit = () => {
    setEditingLineId(null);
    setEditForm(null);
  };

  const handleToggleExclusion = async (lineId: string, currentlyExcluded: boolean) => {
    const success = await toggleLineExclusion(lineId, !currentlyExcluded);
    if (success) {
      loadStatementData();
    }
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      const success = await importStatementLines(statementUploadId);
      if (success) {
        onImportComplete();
      }
    } finally {
      setImporting(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!statement) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground">Statement not found</p>
        </CardContent>
      </Card>
    );
  }

  const unimportedLines = lines.filter((line) => !line.is_imported);
  const excludedLines = unimportedLines.filter((line) => line.user_excluded);
  // Use the shared isLineImportable predicate to ensure UI count matches actual import behavior
  const validLines = lines.filter((line) => isLineImportable(line));
  const invalidLines = unimportedLines.filter((line) => !isLineImportable(line) && !line.user_excluded);

  return (
    <div className="space-y-6">
      {/* Validation Warning Alert */}
      {(invalidLines.length > 0 || excludedLines.length > 0) && (
        <Alert variant={invalidLines.length > 0 ? "destructive" : "default"}>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {invalidLines.length > 0 && (
              <>
                <strong>{invalidLines.length} transaction{invalidLines.length !== 1 ? 's have' : ' has'} validation errors</strong>
                <p className="mt-2 text-sm">
                  These transactions are highlighted in red below. You must edit them to fix the errors before they can be imported. 
                  Common issues include missing amounts, invalid dates, or missing descriptions.
                </p>
              </>
            )}
            {excludedLines.length > 0 && (
              <p className={invalidLines.length > 0 ? "mt-3 text-sm" : "text-sm"}>
                <strong>{excludedLines.length} transaction{excludedLines.length !== 1 ? 's are' : ' is'} excluded</strong> and will be skipped during import.
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Statement Summary */}
      <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
        <CardHeader>
          <div className="flex items-center gap-3">
            <Building2 className="h-6 w-6 text-primary" />
            <div>
              <CardTitle className="text-2xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                {statement.bank_name || 'Bank Statement'}
              </CardTitle>
              <CardDescription>
                {statement.file_name}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Statement Period</p>
              <p className="font-medium">
                {statement.statement_period_start && statement.statement_period_end
                  ? `${format(new Date(statement.statement_period_start), 'MMM d, yyyy')} - ${format(new Date(statement.statement_period_end), 'MMM d, yyyy')}`
                  : 'Not specified'}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Total Credits</p>
              <p className="font-medium text-green-600">
                +{formatCurrency(statement.total_credits || 0)}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Total Debits</p>
              <p className="font-medium text-red-600">
                -{formatCurrency(statement.total_debits || 0)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Transactions Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Review Transactions</CardTitle>
              <CardDescription>
                {validLines.length} ready to import
                {invalidLines.length > 0 && ` • ${invalidLines.length} need correction`}
                {excludedLines.length > 0 && ` • ${excludedLines.length} excluded`}
              </CardDescription>
            </div>
            <Button
              onClick={handleImport}
              disabled={validLines.length === 0 || importing}
              className="gap-2"
            >
              {importing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  Import {validLines.length} Valid Transaction{validLines.length !== 1 ? 's' : ''}
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {lines.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No transactions found</p>
            </div>
          ) : (
            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line) => {
                    const hasError = line.has_validation_error;
                    const validationErrors = line.validation_errors || {};
                    
                    return (
                      <TableRow 
                        key={line.id}
                        className={cn(hasError && "bg-red-50 border-l-4 border-l-red-500")}
                      >
                        <TableCell>
                          {editingLineId === line.id ? (
                            <div className="space-y-1">
                              <Input
                                type="date"
                                value={editForm?.transaction_date || ''}
                                onChange={(e) =>
                                  setEditForm({ ...editForm!, transaction_date: e.target.value })
                                }
                                className={cn("w-40", validationErrors.date && "border-red-500")}
                              />
                              {validationErrors.date && (
                                <p className="text-xs text-red-600">{validationErrors.date}</p>
                              )}
                            </div>
                          ) : (
                            <div className="space-y-1">
                              {line.transaction_date ? (
                                <span>{format(new Date(line.transaction_date), 'MMM d, yyyy')}</span>
                              ) : (
                                <span className="text-red-600 text-sm flex items-center gap-1">
                                  <AlertCircle className="h-3 w-3" />
                                  Missing
                                </span>
                              )}
                              {hasError && validationErrors.date && (
                                <p className="text-xs text-red-600">{validationErrors.date}</p>
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {editingLineId === line.id ? (
                            <div className="space-y-1">
                              <Input
                                value={editForm?.description || ''}
                                onChange={(e) =>
                                  setEditForm({ ...editForm!, description: e.target.value })
                                }
                                className={cn("min-w-[200px]", validationErrors.description && "border-red-500")}
                              />
                              {validationErrors.description && (
                                <p className="text-xs text-red-600">{validationErrors.description}</p>
                              )}
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <span className="line-clamp-2">{line.description || 'Unknown'}</span>
                              {hasError && validationErrors.description && (
                                <p className="text-xs text-red-600">{validationErrors.description}</p>
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {editingLineId === line.id ? (
                            <div className="space-y-1">
                              <Input
                                type="number"
                                step="0.01"
                                value={editForm?.amount !== null ? editForm?.amount : ''}
                                onChange={(e) =>
                                  setEditForm({ ...editForm!, amount: e.target.value ? parseFloat(e.target.value) : null })
                                }
                                className={cn("w-32 text-right", validationErrors.amount && "border-red-500")}
                              />
                              {validationErrors.amount && (
                                <p className="text-xs text-red-600">{validationErrors.amount}</p>
                              )}
                            </div>
                          ) : (
                            <div className="space-y-1">
                              {line.amount !== null ? (
                                <span
                                  className={
                                    line.amount < 0
                                      ? 'text-red-600 font-medium'
                                      : 'text-green-600 font-medium'
                                  }
                                >
                                  {formatCurrency(line.amount)}
                                </span>
                              ) : (
                                <span className="text-red-600 text-sm flex items-center gap-1 justify-end">
                                  <AlertCircle className="h-3 w-3" />
                                  Missing
                                </span>
                              )}
                              {hasError && validationErrors.amount && (
                                <p className="text-xs text-red-600">{validationErrors.amount}</p>
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={line.transaction_type === 'debit' ? 'destructive' : 'default'}>
                            {line.transaction_type}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {line.is_imported ? (
                            <Badge variant="outline" className="bg-green-100 text-green-800">
                              <Check className="w-3 h-3 mr-1" />
                              Imported
                            </Badge>
                          ) : line.user_excluded ? (
                            <Badge variant="outline" className="bg-gray-100 text-gray-600">
                              <X className="w-3 h-3 mr-1" />
                              Excluded
                            </Badge>
                          ) : hasError ? (
                            <Badge variant="destructive" className="gap-1">
                              <AlertCircle className="w-3 h-3" />
                              Has Errors
                            </Badge>
                          ) : (
                            <Badge variant="secondary">Pending</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {!line.is_imported && (
                            <div className="flex justify-end gap-2">
                              {editingLineId === line.id ? (
                                <>
                                  <Button
                                    size="sm"
                                    variant="default"
                                    onClick={handleSaveEdit}
                                  >
                                    Save
                                </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={handleCancelEdit}
                                  >
                                    Cancel
                                  </Button>
                                </>
                              ) : (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleEdit(line)}
                                    title="Edit transaction"
                                  >
                                    <Edit className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant={line.user_excluded ? "default" : "ghost"}
                                    onClick={() => handleToggleExclusion(line.id, line.user_excluded)}
                                    title={line.user_excluded ? "Include in import" : "Exclude from import"}
                                  >
                                    {line.user_excluded ? (
                                      <Plus className="h-3 w-3" />
                                    ) : (
                                      <X className="h-3 w-3" />
                                    )}
                                  </Button>
                                </>
                              )}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
