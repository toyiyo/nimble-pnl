import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useTaxRates } from '@/hooks/useTaxRates';
import { TaxCalculationResult } from '@/types/taxRates';
import { FileText, Download, Printer, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface TaxReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string;
  restaurantName: string;
}

export function TaxReportDialog({ open, onOpenChange, restaurantId, restaurantName }: TaxReportDialogProps) {
  const { calculateTaxes } = useTaxRates(restaurantId);
  const { toast } = useToast();

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [results, setResults] = useState<TaxCalculationResult[] | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);

  const handleCalculate = async () => {
    if (!startDate || !endDate) {
      toast({
        title: 'Missing Dates',
        description: 'Please select both start and end dates.',
        variant: 'destructive',
      });
      return;
    }

    setIsCalculating(true);
    try {
      const data = await calculateTaxes(startDate, endDate);
      setResults(data);

      if (data.length === 0) {
        toast({
          title: 'No Results',
          description: 'No taxable transactions found for the selected period.',
        });
      }
    } catch (error) {
      toast({
        title: 'Error Calculating Taxes',
        description: error instanceof Error ? error.message : 'An error occurred',
        variant: 'destructive',
      });
    } finally {
      setIsCalculating(false);
    }
  };

  const handleExportPDF = () => {
    if (!results || results.length === 0) return;

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();

    // Title
    doc.setFontSize(20);
    doc.text('Tax Report', pageWidth / 2, 20, { align: 'center' });

    // Restaurant and Date Info
    doc.setFontSize(12);
    doc.text(restaurantName, pageWidth / 2, 30, { align: 'center' });
    doc.setFontSize(10);
    doc.text(
      `Period: ${format(new Date(startDate), 'MMM dd, yyyy')} - ${format(new Date(endDate), 'MMM dd, yyyy')}`,
      pageWidth / 2,
      37,
      { align: 'center' }
    );

    // Summary Table
    const tableData = results.map((result) => [
      result.tax_rate_name,
      `${result.tax_rate.toFixed(2)}%`,
      `$${result.total_taxable_amount.toFixed(2)}`,
      `$${result.calculated_tax.toFixed(2)}`,
      result.transaction_count.toString(),
    ]);

    autoTable(doc, {
      startY: 45,
      head: [['Tax Type', 'Rate', 'Taxable Amount', 'Tax Due', 'Transactions']],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [16, 185, 129], textColor: 255 },
      styles: { fontSize: 10 },
    });

    // Total Row
    const totalTaxableAmount = results.reduce((sum, r) => sum + r.total_taxable_amount, 0);
    const totalTaxDue = results.reduce((sum, r) => sum + r.calculated_tax, 0);

    autoTable(doc, {
      startY: (doc as any).lastAutoTable.finalY + 2,
      body: [
        [
          { content: 'TOTAL', styles: { fontStyle: 'bold' } },
          '',
          { content: `$${totalTaxableAmount.toFixed(2)}`, styles: { fontStyle: 'bold' } },
          { content: `$${totalTaxDue.toFixed(2)}`, styles: { fontStyle: 'bold' } },
          '',
        ],
      ],
      theme: 'plain',
      columnStyles: {
        0: { cellWidth: 42 },
        1: { cellWidth: 25 },
        2: { cellWidth: 40, halign: 'right' },
        3: { cellWidth: 35, halign: 'right' },
        4: { cellWidth: 38 },
      },
    });

    // Footer
    const timestamp = format(new Date(), 'MMM dd, yyyy hh:mm a');
    doc.setFontSize(8);
    doc.text(`Generated on ${timestamp}`, 14, doc.internal.pageSize.getHeight() - 10);

    // Save PDF
    const filename = `tax-report-${startDate}-to-${endDate}.pdf`;
    doc.save(filename);

    toast({
      title: 'PDF Downloaded',
      description: `Tax report has been saved as ${filename}`,
    });
  };

  const handlePrint = () => {
    window.print();
  };

  const totalTaxableAmount = results?.reduce((sum, r) => sum + r.total_taxable_amount, 0) || 0;
  const totalTaxDue = results?.reduce((sum, r) => sum + r.calculated_tax, 0) || 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Tax Report
          </DialogTitle>
          <DialogDescription>
            Generate a tax report for a specific date range to see calculated taxes by category.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Date Range Selection */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="start-date">Start Date</Label>
              <Input
                id="start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end-date">End Date</Label>
              <Input
                id="end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          <Button onClick={handleCalculate} disabled={isCalculating} className="w-full gap-2">
            <Calendar className="h-4 w-4" />
            {isCalculating ? 'Calculating...' : 'Calculate Taxes'}
          </Button>

          {/* Results */}
          {results && results.length > 0 && (
            <div className="space-y-4 print:space-y-6">
              {/* Report Header (for print) */}
              <div className="hidden print:block text-center mb-6">
                <h1 className="text-2xl font-bold">Tax Report</h1>
                <p className="text-lg">{restaurantName}</p>
                <p className="text-sm text-muted-foreground">
                  Period: {format(new Date(startDate), 'MMM dd, yyyy')} -{' '}
                  {format(new Date(endDate), 'MMM dd, yyyy')}
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2 print:hidden">
                <Button onClick={handleExportPDF} variant="outline" className="gap-2">
                  <Download className="h-4 w-4" />
                  Export PDF
                </Button>
                <Button onClick={handlePrint} variant="outline" className="gap-2">
                  <Printer className="h-4 w-4" />
                  Print
                </Button>
              </div>

              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Total Taxable Amount
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">${totalTaxableAmount.toFixed(2)}</div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Total Tax Due</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-emerald-600">${totalTaxDue.toFixed(2)}</div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Tax Categories</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{results.length}</div>
                  </CardContent>
                </Card>
              </div>

              {/* Detailed Breakdown */}
              <Card>
                <CardHeader>
                  <CardTitle>Tax Breakdown</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-3 px-2 font-medium">Tax Type</th>
                          <th className="text-right py-3 px-2 font-medium">Rate</th>
                          <th className="text-right py-3 px-2 font-medium">Taxable Amount</th>
                          <th className="text-right py-3 px-2 font-medium">Tax Due</th>
                          <th className="text-right py-3 px-2 font-medium">Transactions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {results.map((result) => (
                          <tr key={result.tax_rate_id} className="border-b">
                            <td className="py-3 px-2">{result.tax_rate_name}</td>
                            <td className="text-right py-3 px-2">{result.tax_rate.toFixed(2)}%</td>
                            <td className="text-right py-3 px-2">
                              ${result.total_taxable_amount.toFixed(2)}
                            </td>
                            <td className="text-right py-3 px-2 font-semibold text-emerald-600">
                              ${result.calculated_tax.toFixed(2)}
                            </td>
                            <td className="text-right py-3 px-2">{result.transaction_count}</td>
                          </tr>
                        ))}
                        <tr className="border-t-2 font-bold">
                          <td className="py-3 px-2">TOTAL</td>
                          <td className="text-right py-3 px-2"></td>
                          <td className="text-right py-3 px-2">${totalTaxableAmount.toFixed(2)}</td>
                          <td className="text-right py-3 px-2 text-emerald-600">
                            ${totalTaxDue.toFixed(2)}
                          </td>
                          <td className="text-right py-3 px-2"></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              {/* Print Footer */}
              <div className="hidden print:block text-center text-sm text-muted-foreground mt-8">
                Generated on {format(new Date(), 'MMM dd, yyyy hh:mm a')}
              </div>
            </div>
          )}

          {results && results.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center">
                <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Results Found</h3>
                <p className="text-sm text-muted-foreground">
                  No taxable transactions were found for the selected period.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
