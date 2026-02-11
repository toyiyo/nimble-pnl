import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/utils";
import { format } from "date-fns";
import type { Invoice } from "@/hooks/useInvoices";
import type { Restaurant } from "@/hooks/useRestaurants";

interface InvoicePreviewDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly invoice: Invoice;
  readonly restaurant: Restaurant | null;
}

export function InvoicePreviewDialog({
  open,
  onOpenChange,
  invoice,
  restaurant,
}: InvoicePreviewDialogProps) {
  const restaurantName = restaurant?.legal_name || restaurant?.name || '';
  const restaurantAddress = [
    restaurant?.address_line1,
    restaurant?.address_line2,
    [restaurant?.city, restaurant?.state, restaurant?.zip].filter(Boolean).join(', '),
  ].filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-0 gap-0">
        <DialogHeader className="sr-only">
          <DialogTitle>Invoice Preview</DialogTitle>
          <DialogDescription>Preview of invoice {invoice.invoice_number || 'draft'}</DialogDescription>
        </DialogHeader>

        <div className="bg-background p-8 space-y-8">
          {/* From / Invoice Header */}
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <h2 className="text-[17px] font-semibold text-foreground">{restaurantName}</h2>
              {restaurantAddress.map((line, i) => (
                <p key={i} className="text-[13px] text-muted-foreground">{line}</p>
              ))}
              {restaurant?.business_email && (
                <p className="text-[13px] text-muted-foreground">{restaurant.business_email}</p>
              )}
              {restaurant?.phone && (
                <p className="text-[13px] text-muted-foreground">{restaurant.phone}</p>
              )}
            </div>
            <div className="text-right space-y-1">
              <h1 className="text-[28px] font-bold text-foreground tracking-tight">INVOICE</h1>
              <p className="text-[13px] text-muted-foreground">
                {invoice.invoice_number || `Draft`}
              </p>
              <p className="text-[13px] text-muted-foreground">
                {format(new Date(invoice.invoice_date), 'MMMM d, yyyy')}
              </p>
              {invoice.due_date && (
                <p className="text-[13px] text-muted-foreground">
                  Due: {format(new Date(invoice.due_date), 'MMMM d, yyyy')}
                </p>
              )}
            </div>
          </div>

          {/* Bill To */}
          <div className="space-y-1">
            <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Bill To</p>
            <h3 className="text-[15px] font-semibold text-foreground">{invoice.customers?.name}</h3>
            {invoice.customers?.email && (
              <p className="text-[13px] text-muted-foreground">{invoice.customers.email}</p>
            )}
            {invoice.customers?.billing_address_line1 && (
              <p className="text-[13px] text-muted-foreground">{invoice.customers.billing_address_line1}</p>
            )}
            {invoice.customers?.billing_address_line2 && (
              <p className="text-[13px] text-muted-foreground">{invoice.customers.billing_address_line2}</p>
            )}
            {(invoice.customers?.billing_address_city || invoice.customers?.billing_address_state || invoice.customers?.billing_address_postal_code) && (
              <p className="text-[13px] text-muted-foreground">
                {[
                  invoice.customers.billing_address_city,
                  invoice.customers.billing_address_state,
                  invoice.customers.billing_address_postal_code,
                ].filter(Boolean).join(', ')}
              </p>
            )}
          </div>

          {/* Description */}
          {invoice.description && (
            <p className="text-[14px] text-muted-foreground">{invoice.description}</p>
          )}

          {/* Line Items Table */}
          <div className="rounded-xl border border-border/40 overflow-hidden">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="bg-muted/50 border-b border-border/40">
                  <th className="text-left px-4 py-3 text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Description</th>
                  <th className="text-right px-4 py-3 text-[12px] font-medium text-muted-foreground uppercase tracking-wider w-20">Qty</th>
                  <th className="text-right px-4 py-3 text-[12px] font-medium text-muted-foreground uppercase tracking-wider w-28">Unit Price</th>
                  <th className="text-right px-4 py-3 text-[12px] font-medium text-muted-foreground uppercase tracking-wider w-28">Amount</th>
                </tr>
              </thead>
              <tbody>
                {invoice.invoice_line_items?.map((item, index) => (
                  <tr key={item.id || index} className="border-b border-border/40 last:border-b-0">
                    <td className="px-4 py-3 text-foreground">{item.description}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{item.quantity}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {formatCurrency(item.unit_amount / 100, invoice.currency)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-foreground">
                      {formatCurrency((item.amount ?? (item.quantity * item.unit_amount)) / 100, invoice.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-64 space-y-2">
              <div className="flex justify-between text-[14px]">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatCurrency(invoice.subtotal / 100, invoice.currency)}</span>
              </div>
              {invoice.stripe_fee_amount > 0 && (
                <div className="flex justify-between text-[14px]">
                  <span className="text-muted-foreground">Processing Fee</span>
                  <span>{formatCurrency(invoice.stripe_fee_amount / 100, invoice.currency)}</span>
                </div>
              )}
              {invoice.tax > 0 && (
                <div className="flex justify-between text-[14px]">
                  <span className="text-muted-foreground">Tax</span>
                  <span>{formatCurrency(invoice.tax / 100, invoice.currency)}</span>
                </div>
              )}
              <div className="flex justify-between text-[17px] font-semibold pt-2 border-t border-border/40">
                <span>Total</span>
                <span>{formatCurrency(invoice.total / 100, invoice.currency)}</span>
              </div>
            </div>
          </div>

          {/* Footer */}
          {invoice.footer && (
            <div className="pt-4 border-t border-border/40">
              <p className="text-[13px] text-muted-foreground">{invoice.footer}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
