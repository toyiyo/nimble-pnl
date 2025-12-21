import { useParams, useNavigate } from "react-router-dom";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { useInvoices } from "@/hooks/useInvoices";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  ArrowLeft,
  FileText,
  Send,
  Download,
  ExternalLink,
  CheckCircle,
  Clock,
  XCircle,
  Ban,
  AlertCircle,
  Mail,
  Phone,
  MapPin,
  RefreshCw
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const statusConfig = {
  draft: { icon: FileText, color: "bg-gray-100 text-gray-800", label: "Draft" },
  open: { icon: Clock, color: "bg-blue-100 text-blue-800", label: "Sent" },
  paid: { icon: CheckCircle, color: "bg-green-100 text-green-800", label: "Paid" },
  void: { icon: Ban, color: "bg-red-100 text-red-800", label: "Void" },
  uncollectible: { icon: AlertCircle, color: "bg-orange-100 text-orange-800", label: "Uncollectible" },
};

export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { selectedRestaurant } = useRestaurantContext();
  const { useInvoice, sendInvoice, syncInvoiceStatus, isSending, isSyncingStatus } = useInvoices(selectedRestaurant?.restaurant_id || null);
  const { data: invoice, isLoading, error } = useInvoice(id || null);
  const { toast } = useToast();

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <Skeleton className="h-8 w-48" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Skeleton className="h-64" />
            <Skeleton className="h-48" />
          </div>
          <div className="space-y-6">
            <Skeleton className="h-32" />
            <Skeleton className="h-48" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="container mx-auto p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Invoice Not Found</AlertTitle>
          <AlertDescription>
            The invoice you're looking for doesn't exist or you don't have permission to view it.
          </AlertDescription>
        </Alert>
        <Button
          variant="outline"
          onClick={() => navigate('/invoices')}
          className="mt-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Invoices
        </Button>
      </div>
    );
  }

  const statusInfo = statusConfig[invoice.status];
  const StatusIcon = statusInfo.icon;

  const handleSendInvoice = async () => {
    try {
      await sendInvoice(invoice.id);
      toast({
        title: "Invoice Sent",
        description: "The invoice has been sent to the customer successfully.",
      });
    } catch (error) {
      console.error('Error sending invoice:', error);
    }
  };

  const handleViewHostedInvoice = () => {
    if (invoice.hosted_invoice_url) {
      window.open(invoice.hosted_invoice_url, '_blank');
    }
  };

  const handleDownloadPDF = () => {
    if (invoice.invoice_pdf_url) {
      window.open(invoice.invoice_pdf_url, '_blank');
    }
  };

  const handleSyncStatus = async () => {
    try {
      await syncInvoiceStatus(invoice.id);
    } catch (error) {
      console.error('Error syncing invoice status:', error);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/invoices')}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Invoices
          </Button>
          <div>
          <div>
            <h1 className="text-2xl font-bold">
              Invoice {invoice.invoice_number || invoice.id.slice(-8)}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <Badge className={statusInfo.color}>
                <StatusIcon className="h-3 w-3 mr-1" />
                {statusInfo.label}
              </Badge>
              <span className="text-sm text-muted-foreground">
                Created {format(new Date(invoice.created_at), 'MMM d, yyyy')}
              </span>
              {process.env.NODE_ENV === 'development' && (
                <span className="text-xs text-muted-foreground">
                  Stripe ID: {invoice.stripe_invoice_id || 'null'}
                </span>
              )}
            </div>
          </div>
          </div>
        </div>

        <div className="flex gap-2">
          {invoice.status === 'draft' && (
            <Button
              onClick={handleSendInvoice}
              disabled={isSending}
              className="bg-primary hover:bg-primary/90"
            >
              <Send className="h-4 w-4 mr-2" />
              {isSending ? 'Sending...' : 'Send Invoice'}
            </Button>
          )}

          {invoice.stripe_invoice_id && (
            <Button
              variant="outline"
              onClick={handleSyncStatus}
              disabled={isSyncingStatus}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isSyncingStatus ? 'animate-spin' : ''}`} />
              {isSyncingStatus ? 'Syncing...' : 'Sync Status'}
            </Button>
          )}

          {invoice.hosted_invoice_url && (
            <Button
              variant="outline"
              onClick={handleViewHostedInvoice}
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              View Invoice
            </Button>
          )}

          {invoice.invoice_pdf_url && (
            <Button
              variant="outline"
              onClick={handleDownloadPDF}
            >
              <Download className="h-4 w-4 mr-2" />
              Download PDF
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Customer Information */}
          <Card>
            <CardHeader>
              <CardTitle>Customer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <h3 className="font-semibold text-lg">{invoice.customers?.name}</h3>
                {invoice.customers?.email && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Mail className="h-4 w-4" />
                    {invoice.customers.email}
                  </div>
                )}
                {invoice.customers?.phone && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Phone className="h-4 w-4" />
                    {invoice.customers.phone}
                  </div>
                )}
              </div>

              {(invoice.customers?.billing_address_line1 ||
                invoice.customers?.billing_address_city) && (
                <div className="flex items-start gap-2 text-sm text-muted-foreground">
                  <MapPin className="h-4 w-4 mt-0.5" />
                  <div>
                    {invoice.customers.billing_address_line1 && (
                      <div>{invoice.customers.billing_address_line1}</div>
                    )}
                    {invoice.customers.billing_address_line2 && (
                      <div>{invoice.customers.billing_address_line2}</div>
                    )}
                    {(invoice.customers.billing_address_city ||
                      invoice.customers.billing_address_state ||
                      invoice.customers.billing_address_postal_code) && (
                      <div>
                        {[
                          invoice.customers.billing_address_city,
                          invoice.customers.billing_address_state,
                          invoice.customers.billing_address_postal_code
                        ].filter(Boolean).join(', ')}
                      </div>
                    )}
                    {invoice.customers.billing_address_country && (
                      <div>{invoice.customers.billing_address_country}</div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Line Items */}
          <Card>
            <CardHeader>
              <CardTitle>Items</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {invoice.invoice_line_items?.map((item, index) => (
                  <div key={item.id || index} className="flex justify-between items-start py-2 border-b last:border-b-0">
                    <div className="flex-1">
                      <div className="font-medium">{item.description}</div>
                      <div className="text-sm text-muted-foreground">
                        Quantity: {item.quantity} × {formatCurrency(item.unit_amount / 100, invoice.currency)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium">
                        {formatCurrency((item.amount || (item.quantity * item.unit_amount)) / 100, invoice.currency)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Additional Details */}
          {(invoice.description || invoice.memo || invoice.footer) && (
            <Card>
              <CardHeader>
                <CardTitle>Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {invoice.description && (
                  <div>
                    <h4 className="font-medium mb-2">Description</h4>
                    <p className="text-sm text-muted-foreground">{invoice.description}</p>
                  </div>
                )}
                {invoice.memo && (
                  <div>
                    <h4 className="font-medium mb-2">Memo</h4>
                    <p className="text-sm text-muted-foreground">{invoice.memo}</p>
                  </div>
                )}
                {invoice.footer && (
                  <div>
                    <h4 className="font-medium mb-2">Footer</h4>
                    <p className="text-sm text-muted-foreground">{invoice.footer}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Invoice Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Invoice Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatCurrency(invoice.subtotal / 100, invoice.currency)}</span>
              </div>
              {invoice.tax > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tax</span>
                  <span>{formatCurrency(invoice.tax / 100, invoice.currency)}</span>
                </div>
              )}
              <div className="flex justify-between font-medium text-lg pt-2 border-t">
                <span>Total</span>
                <span>{formatCurrency(invoice.total / 100, invoice.currency)}</span>
              </div>
              {invoice.amount_paid > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>Paid</span>
                  <span>-{formatCurrency(invoice.amount_paid / 100, invoice.currency)}</span>
                </div>
              )}
              {invoice.amount_remaining > 0 && (
                <div className="flex justify-between font-medium">
                  <span>Amount Due</span>
                  <span>{formatCurrency(invoice.amount_remaining / 100, invoice.currency)}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Dates */}
          <Card>
            <CardHeader>
              <CardTitle>Dates</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Invoice Date</span>
                <span>{format(new Date(invoice.invoice_date), 'MMM d, yyyy')}</span>
              </div>
              {invoice.due_date && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Due Date</span>
                  <span>{format(new Date(invoice.due_date), 'MMM d, yyyy')}</span>
                </div>
              )}
              {invoice.paid_at && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Paid Date</span>
                  <span>{format(new Date(invoice.paid_at), 'MMM d, yyyy')}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Status Information */}
          {invoice.status === 'paid' && (
            <Alert>
              <CheckCircle className="h-4 w-4" />
              <AlertTitle>Payment Received</AlertTitle>
              <AlertDescription>
                This invoice has been paid in full. Funds have been transferred to your connected account.
              </AlertDescription>
            </Alert>
          )}

          {invoice.status === 'open' && (
            <Alert>
              <Clock className="h-4 w-4" />
              <AlertTitle>Awaiting Payment</AlertTitle>
              <AlertDescription>
                This invoice has been sent to the customer and is awaiting payment.
              </AlertDescription>
            </Alert>
          )}

          {invoice.status === 'uncollectible' && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Payment Failed</AlertTitle>
              <AlertDescription>
                This invoice is marked as uncollectible. You may need to follow up with the customer.
              </AlertDescription>
            </Alert>
          )}
        </div>
      </div>
    </div>
  );
}