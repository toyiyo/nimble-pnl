import React, { useState, useEffect } from 'react';
import { ReceiptUpload } from '@/components/ReceiptUpload';
import { ReceiptMappingReview } from '@/components/ReceiptMappingReview';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useReceiptImport, ReceiptImport as ReceiptImportType } from '@/hooks/useReceiptImport';
import { ArrowLeft, FileText, Clock, CheckCircle, AlertCircle, Receipt } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';

export const ReceiptImport = () => {
  const [activeReceiptId, setActiveReceiptId] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<ReceiptImportType[]>([]);
  const [loading, setLoading] = useState(true);
  const { getReceiptImports } = useReceiptImport();
  const navigate = useNavigate();

  useEffect(() => {
    loadReceipts();
  }, []);

  const loadReceipts = async () => {
    setLoading(true);
    const data = await getReceiptImports();
    setReceipts(data);
    setLoading(false);
  };

  const handleReceiptProcessed = (receiptId: string) => {
    setActiveReceiptId(receiptId);
    loadReceipts();
  };

  const handleImportComplete = () => {
    setActiveReceiptId(null);
    loadReceipts();
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'uploaded':
        return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" />Uploaded</Badge>;
      case 'processed':
        return <Badge variant="default"><AlertCircle className="w-3 h-3 mr-1" />Ready to Review</Badge>;
      case 'imported':
        return <Badge variant="default" className="bg-green-100 text-green-800"><CheckCircle className="w-3 h-3 mr-1" />Imported</Badge>;
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  const formatCurrency = (amount: number | null) => {
    if (!amount) return 'N/A';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Receipt className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Receipt Import</h1>
            <p className="text-muted-foreground">Upload receipts and automatically import items to inventory</p>
          </div>
        </div>
        <Button variant="outline" onClick={() => navigate('/inventory')} className="flex items-center gap-2">
          <ArrowLeft className="w-4 h-4" />
          Back to Inventory
        </Button>
      </div>

      {!activeReceiptId ? (
        <Tabs defaultValue="upload" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="upload">Upload Receipt</TabsTrigger>
            <TabsTrigger value="history">Receipt History</TabsTrigger>
          </TabsList>
          <TabsContent value="upload">
            <ReceiptUpload onReceiptProcessed={handleReceiptProcessed} />
          </TabsContent>
          <TabsContent value="history">
            <Card>
              <CardHeader>
                <CardTitle>Receipt History</CardTitle>
                <CardDescription>View and manage your uploaded receipts</CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mr-2"></div>
                    Loading receipts...
                  </div>
                ) : receipts.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No receipts uploaded yet. Upload your first receipt to get started!
                  </div>
                ) : (
                  <div className="space-y-4">
                    {receipts.map((receipt) => (
                      <div key={receipt.id} className="border rounded-lg p-4 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <FileText className="w-8 h-8 text-muted-foreground" />
                          <div>
                            <div className="font-medium">{receipt.vendor_name || receipt.file_name || 'Unknown Receipt'}</div>
                            <div className="text-sm text-muted-foreground">
                              Uploaded {format(new Date(receipt.created_at), 'PPp')}
                            </div>
                            {receipt.total_amount && (
                              <div className="text-sm font-medium">Total: {formatCurrency(receipt.total_amount)}</div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {getStatusBadge(receipt.status)}
                          {receipt.status === 'processed' && (
                            <Button size="sm" onClick={() => setActiveReceiptId(receipt.id)}>Review Items</Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      ) : (
        <div className="space-y-4">
          <Button variant="outline" onClick={() => setActiveReceiptId(null)} className="flex items-center gap-2">
            <ArrowLeft className="w-4 h-4" />
            Back to Receipts
          </Button>
          <ReceiptMappingReview receiptId={activeReceiptId} onImportComplete={handleImportComplete} />
        </div>
      )}
    </div>
  );
};