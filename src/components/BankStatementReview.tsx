import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useBankStatementImport, type BankStatementLine, type BankStatementUpload } from '@/hooks/useBankStatementImport';
import { FileText, Check, Edit, Trash2, DollarSign, Calendar, Building2 } from 'lucide-react';
import { format } from 'date-fns';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    transaction_date: string;
    description: string;
    amount: number;
  } | null>(null);

  const {
    getBankStatementDetails,
    getBankStatementLines,
    updateStatementLine,
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

  const handleImport = async () => {
    const success = await importStatementLines(statementUploadId);
    if (success) {
      onImportComplete();
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

  return (
    <div className="space-y-6">
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
                Review and edit the extracted transactions before importing
              </CardDescription>
            </div>
            <Button
              onClick={handleImport}
              disabled={unimportedLines.length === 0}
              className="gap-2"
            >
              <Check className="h-4 w-4" />
              Import {unimportedLines.length} Transaction{unimportedLines.length !== 1 ? 's' : ''}
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
                  {lines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell>
                        {editingLineId === line.id ? (
                          <Input
                            type="date"
                            value={editForm?.transaction_date || ''}
                            onChange={(e) =>
                              setEditForm({ ...editForm!, transaction_date: e.target.value })
                            }
                            className="w-40"
                          />
                        ) : (
                          format(new Date(line.transaction_date), 'MMM d, yyyy')
                        )}
                      </TableCell>
                      <TableCell>
                        {editingLineId === line.id ? (
                          <Input
                            value={editForm?.description || ''}
                            onChange={(e) =>
                              setEditForm({ ...editForm!, description: e.target.value })
                            }
                            className="min-w-[200px]"
                          />
                        ) : (
                          <span className="line-clamp-2">{line.description}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {editingLineId === line.id ? (
                          <Input
                            type="number"
                            step="0.01"
                            value={editForm?.amount || 0}
                            onChange={(e) =>
                              setEditForm({ ...editForm!, amount: parseFloat(e.target.value) })
                            }
                            className="w-32 text-right"
                          />
                        ) : (
                          <span
                            className={
                              line.amount < 0
                                ? 'text-red-600 font-medium'
                                : 'text-green-600 font-medium'
                            }
                          >
                            {formatCurrency(line.amount)}
                          </span>
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
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleEdit(line)}
                              >
                                <Edit className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
