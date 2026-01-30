import React, { useState, useEffect, useMemo } from 'react';
import { ReceiptUpload } from '@/components/ReceiptUpload';
import { ReceiptMappingReview } from '@/components/ReceiptMappingReview';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { useReceiptImport, ReceiptImport as ReceiptImportType } from '@/hooks/useReceiptImport';
import { ArrowLeft, FileText, Clock, CheckCircle, AlertCircle, Receipt } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { MetricIcon } from '@/components/MetricIcon';
import { FeatureGate } from '@/components/subscription';

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
      {/* Gradient Header */}
      <div className="flex items-center justify-between p-6 rounded-lg bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border border-border/50">
        <div className="flex items-center gap-3">
          <MetricIcon icon={Receipt} variant="blue" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Receipt Import</h1>
            <p className="text-muted-foreground">Upload receipts and automatically import items to inventory</p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => navigate('/inventory')}
          className="flex items-center gap-2"
          aria-label="Navigate back to inventory page"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Inventory
        </Button>
      </div>

      <FeatureGate featureKey="inventory_automation">
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
                  <div className="space-y-4" role="status" aria-label="Loading receipts">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="border rounded-lg p-4">
                        <div className="flex items-center gap-4">
                          <Skeleton className="h-8 w-8 rounded" />
                          <div className="flex-1 space-y-2">
                            <Skeleton className="h-4 w-[200px]" />
                            <Skeleton className="h-3 w-[150px]" />
                          </div>
                          <Skeleton className="h-9 w-24 rounded-md" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : receipts.length === 0 ? (
                  <div 
                    className="text-center py-12 px-4 rounded-lg bg-gradient-to-br from-primary/5 via-accent/5 to-transparent"
                    role="status"
                    aria-label="No receipts found"
                  >
                    <Receipt className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
                    <p className="text-muted-foreground font-medium mb-1">No receipts uploaded yet</p>
                    <p className="text-sm text-muted-foreground/70">Upload your first receipt to get started!</p>
                  </div>
                ) : (
                  <div className="space-y-4" role="list" aria-label="Receipt history">
                    {receipts.map((receipt) => (
                      <div 
                        key={receipt.id} 
                        className="border rounded-lg p-4 flex items-center justify-between hover:bg-accent/50 transition-all duration-200 cursor-pointer group focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2"
                        onClick={() => setActiveReceiptId(receipt.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setActiveReceiptId(receipt.id);
                          }
                        }}
                        tabIndex={0}
                        role="listitem"
                        aria-label={`Receipt from ${receipt.vendor_name || receipt.file_name || 'Unknown vendor'}, uploaded ${format(new Date(receipt.created_at), 'PPp')}`}
                      >
                        <div className="flex items-center gap-4">
                          <FileText className="w-8 h-8 text-muted-foreground group-hover:text-primary transition-all duration-200 group-hover:scale-110" />
                          <div>
                            <div className="font-medium group-hover:text-primary transition-colors">
                              {receipt.vendor_name || receipt.file_name || 'Unknown Receipt'}
                            </div>
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
                          <Button 
                            size="sm" 
                            variant={receipt.status === 'processed' ? 'default' : 'outline'}
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveReceiptId(receipt.id);
                            }}
                            aria-label={receipt.status === 'processed' ? 'Review receipt items' : 'View receipt details'}
                          >
                            {receipt.status === 'processed' ? 'Review Items' : 'View Details'}
                          </Button>
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
          <Button
            variant="outline"
            onClick={() => setActiveReceiptId(null)}
            className="flex items-center gap-2"
            aria-label="Navigate back to receipt list"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Receipts
          </Button>
          <ReceiptMappingReview receiptId={activeReceiptId} onImportComplete={handleImportComplete} />
        </div>
      )}
      </FeatureGate>
    </div>
  );
};