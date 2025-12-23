import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { useCustomers } from "@/hooks/useCustomers";
import { useInvoices, type InvoiceLineItem } from "@/hooks/useInvoices";
import { useStripeConnect } from "@/hooks/useStripeConnect";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { FileText, Plus, Trash2, ArrowLeft, CreditCard } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function InvoiceForm() {
  type LocalLineItem = InvoiceLineItem & { localId: string };

  const makeId = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { selectedRestaurant } = useRestaurantContext();
  const { customers } = useCustomers(selectedRestaurant?.restaurant_id || null);
  const { createInvoice, isCreating, createdInvoice } = useInvoices(selectedRestaurant?.restaurant_id || null);
  const { isReadyForInvoicing, createAccount, isCreatingAccount, openDashboard, isOpeningDashboard } = useStripeConnect(selectedRestaurant?.restaurant_id || null);
  
  const [customerId, setCustomerId] = useState(searchParams.get("customer") || "");
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [footer, setFooter] = useState("");
  const [memo, setMemo] = useState("");
  const [passFeesToCustomer, setPassFeesToCustomer] = useState(false);
  const [lineItems, setLineItems] = useState<LocalLineItem[]>([
    { localId: makeId(), description: "", quantity: 1, unit_amount: 0 },
  ]);

  // Navigate to invoice detail page when invoice is created
  useEffect(() => {
    if (createdInvoice?.invoiceId) {
      navigate(`/invoices/${createdInvoice.invoiceId}`);
    }
  }, [createdInvoice, navigate]);

  // Check if Stripe Connect is ready for invoicing
  if (!isReadyForInvoicing) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
         <CardHeader>
           <div className="flex items-center justify-between">
             <div className="flex items-center gap-3">
                <FileText className="h-6 w-6 text-primary" />
                <div>
                  <CardTitle className="text-2xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                    Create Invoice
                  </CardTitle>
                  <CardDescription>Create a new invoice for your customer</CardDescription>
                </div>
              </div>
              <Button variant="outline" onClick={() => navigate('/invoices')}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
            </div>
          </CardHeader>
        </Card>

        <Alert>
          <CreditCard className="h-4 w-4" />
          <AlertTitle>Stripe Connect Setup Required</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              To create and send invoices with payment collection, you need to set up Stripe Connect for your restaurant.
              This allows your customers to pay by credit card or US bank account (ACH).
            </p>
            <div className="flex gap-3">
              <Button 
                onClick={() => createAccount('express')} 
                disabled={isCreatingAccount}
                className="flex-1"
              >
                {isCreatingAccount ? "Setting up..." : "Set up Stripe Connect"}
              </Button>
              <Button 
                variant="outline" 
                onClick={() => navigate('/invoices')}
                className="flex-1"
              >
                View Invoices
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const addLineItem = () => {
    setLineItems([...lineItems, { localId: makeId(), description: "", quantity: 1, unit_amount: 0 }]);
  };

  const removeLineItem = (index: number) => {
    setLineItems(lineItems.filter((_, i) => i !== index));
  };

  const updateLineItem = (index: number, field: keyof InvoiceLineItem, value: string | number | ('inclusive' | 'exclusive' | 'unspecified') | undefined) => {
    const updated = [...lineItems];
    updated[index] = { ...updated[index], [field]: value };
    setLineItems(updated);
  };

  const calculateSubtotal = () => {
    let subtotal = lineItems.reduce((sum, item) => {
      const quantity = Number(item.quantity) || 0;
      const unitAmount = Number(item.unit_amount) || 0;
      return sum + (quantity * unitAmount);
    }, 0);

    // Add grossed-up processing fee if passFeesToCustomer is enabled
    if (passFeesToCustomer) {
      const baseCents = Math.round(subtotal * 100);
      const gross = Math.round((baseCents + 30) / (1 - 0.029));
      const feeCents = Math.max(0, gross - baseCents);
      subtotal += feeCents / 100;
    }

    return subtotal;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!customerId) {
      alert("Please select a customer");
      return;
    }

    if (lineItems.every(item => !item.description)) {
      alert("Please add at least one line item");
      return;
    }

    // Convert dollar amounts to cents
    const itemsInCents = lineItems
      .filter(item => item.description.trim() !== "")
      .map(item => ({
        ...item,
        localId: item.localId,
        unit_amount: Math.round(Number(item.unit_amount) * 100),
      }));

    createInvoice({
      customerId,
      lineItems: itemsInCents,
      dueDate: dueDate || undefined,
      description: description || undefined,
      footer: footer || undefined,
      memo: memo || undefined,
      passFeesToCustomer,
    });

    // Navigation will happen in useEffect when createdInvoice is available
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileText className="h-6 w-6 text-primary" />
              <div>
                <CardTitle className="text-2xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                  Create Invoice
                </CardTitle>
                <CardDescription>Create a new invoice for your customer</CardDescription>
              </div>
            </div>
            <Button variant="outline" onClick={() => navigate('/invoices')}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          </div>
        </CardHeader>
      </Card>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Customer & Due Date */}
        <Card>
          <CardHeader>
            <CardTitle>Invoice Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="customer">
                  Customer <span className="text-destructive">*</span>
                </Label>
                <Select value={customerId} onValueChange={setCustomerId}>
                  <SelectTrigger id="customer">
                    <SelectValue placeholder="Select a customer" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((customer) => (
                      <SelectItem key={customer.id} value={customer.id}>
                        {customer.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="dueDate">Due Date</Label>
                <Input
                  id="dueDate"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of this invoice"
              />
            </div>
          </CardContent>
        </Card>

        {/* Line Items */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Line Items</CardTitle>
              <Button type="button" variant="outline" size="sm" onClick={addLineItem}>
                <Plus className="h-4 w-4 mr-2" />
                Add Item
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {lineItems.map((item, index) => (
                <div key={item.id || item.localId} className="flex gap-2 items-start">
                  <div className="flex-1 space-y-2">
                    <Input
                      placeholder="Description"
                      value={item.description}
                      onChange={(e) => updateLineItem(index, "description", e.target.value)}
                    />
                  </div>
                  <div className="w-24 space-y-2">
                    <Input
                      type="number"
                      placeholder="Qty"
                      min="0.001"
                      step="0.001"
                      value={item.quantity}
                      onChange={(e) => updateLineItem(index, "quantity", e.target.value)}
                    />
                  </div>
                  <div className="w-32 space-y-2">
                    <Input
                      type="number"
                      placeholder="Price"
                      min="0"
                      step="0.01"
                      value={item.unit_amount}
                      onChange={(e) => updateLineItem(index, "unit_amount", e.target.value)}
                    />
                  </div>
                  <div className="w-32 text-right pt-2">
                    {formatCurrency((Number(item.quantity) || 0) * (Number(item.unit_amount) || 0))}
                  </div>
                  {lineItems.length > 1 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => removeLineItem(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-6 pt-6 border-t">
              <div className="space-y-2">
                {passFeesToCustomer && (
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>Processing Fee (est.)</span>
                    <span>
                      {(() => {
                        const baseCents = Math.round(
                          lineItems.reduce((sum, item) => {
                            const quantity = Number(item.quantity) || 0;
                            const unitAmount = Number(item.unit_amount) || 0;
                            return sum + quantity * unitAmount;
                          }, 0) * 100
                        );
                        const gross = Math.round((baseCents + 30) / (1 - 0.029));
                        const feeCents = Math.max(0, gross - baseCents);
                        return formatCurrency(feeCents / 100);
                      })()}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-lg font-semibold">
                  <span>Total:</span>
                  <span>{formatCurrency(calculateSubtotal())}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Additional Details */}
        <Card>
          <CardHeader>
            <CardTitle>Additional Details (Optional)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="footer">Footer</Label>
              <Textarea
                id="footer"
                value={footer}
                onChange={(e) => setFooter(e.target.value)}
                placeholder="Terms, payment instructions, or notes for the customer"
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="memo">Internal Memo</Label>
              <Textarea
                id="memo"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="Internal notes (not visible to customer)"
                rows={2}
              />
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="passFees"
                checked={passFeesToCustomer}
                onCheckedChange={(checked) => setPassFeesToCustomer(checked as boolean)}
              />
              <Label htmlFor="passFees" className="text-sm space-y-1">
                <span>Add processing fee to invoice</span>
                <span className="text-muted-foreground block text-xs">
                  Customer will see and pay ~2.9% + $0.30 processing fee on their invoice
                </span>
              </Label>
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => navigate('/invoices')}>
            Cancel
          </Button>
          <Button type="submit" disabled={isCreating}>
            {isCreating ? "Creating..." : "Create Invoice"}
          </Button>
        </div>
      </form>
    </div>
  );
}
