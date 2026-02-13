import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams, useParams } from "react-router-dom";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { useCustomers } from "@/hooks/useCustomers";
import { useInvoices, useInvoice, type InvoiceLineItem } from "@/hooks/useInvoices";
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
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { FileText, Plus, Trash2, ArrowLeft, UserPlus, AlertTriangle } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { computeProcessingFeeCents } from "@/lib/invoiceUtils";
import { CustomerFormDialog } from "@/components/invoicing/CustomerFormDialog";

type LocalLineItem = InvoiceLineItem & { localId: string };

function makeId(): string {
  return crypto.randomUUID();
}

export default function InvoiceForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { id: editInvoiceId } = useParams<{ id: string }>();
  const { selectedRestaurant } = useRestaurantContext();
  const { customers } = useCustomers(selectedRestaurant?.restaurant_id || null);
  const { createInvoice, createLocalDraft, updateInvoiceAsync, isCreating, isCreatingDraft, isUpdating, createdInvoice, createdDraft } = useInvoices(selectedRestaurant?.restaurant_id || null);
  const { isReadyForInvoicing } = useStripeConnect(selectedRestaurant?.restaurant_id || null);
  const { data: existingInvoice } = useInvoice(editInvoiceId || null);

  const isEditMode = !!editInvoiceId && !!existingInvoice;

  const [customerId, setCustomerId] = useState(searchParams.get("customer") || "");
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [footer, setFooter] = useState("");
  const [memo, setMemo] = useState("");
  const [passFeesToCustomer, setPassFeesToCustomer] = useState(false);
  const [lineItems, setLineItems] = useState<LocalLineItem[]>([
    { localId: makeId(), description: "", quantity: 1, unit_amount: 0 },
  ]);
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [showEditCustomerForm, setShowEditCustomerForm] = useState(false);

  const selectedCustomer = customers.find(c => c.id === customerId) || null;
  const customerMissingEmail = !!selectedCustomer && !selectedCustomer.email && isReadyForInvoicing;

  // Navigate to invoice detail page when invoice is created
  useEffect(() => {
    if (createdInvoice?.invoiceId) {
      navigate(`/invoices/${createdInvoice.invoiceId}`);
    }
  }, [createdInvoice, navigate]);

  // Navigate to invoice detail page when local draft is created
  useEffect(() => {
    if (createdDraft?.invoiceId) {
      navigate(`/invoices/${createdDraft.invoiceId}`);
    }
  }, [createdDraft, navigate]);

  // Populate form when editing an existing invoice (guard prevents refetch overwriting edits)
  const hasPopulatedRef = useRef(false);
  useEffect(() => {
    if (existingInvoice && editInvoiceId && !hasPopulatedRef.current) {
      hasPopulatedRef.current = true;
      setCustomerId(existingInvoice.customer_id);
      setDueDate(existingInvoice.due_date ? existingInvoice.due_date.split('T')[0] : '');
      setDescription(existingInvoice.description || '');
      setFooter(existingInvoice.footer || '');
      setMemo(existingInvoice.memo || '');
      setPassFeesToCustomer(existingInvoice.pass_fees_to_customer || false);
      if (existingInvoice.invoice_line_items?.length) {
        setLineItems(
          existingInvoice.invoice_line_items
            .filter(item => item.description !== 'Processing Fee')
            .map(item => ({
              ...item,
              localId: item.id || makeId(),
              unit_amount: item.unit_amount / 100, // Convert from cents to dollars
              quantity: item.quantity,
              description: item.description,
            }))
        );
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingInvoice, editInvoiceId]);

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

  const subtotalDollars = lineItems.reduce((sum, item) => {
    const quantity = Number(item.quantity) || 0;
    const unitAmount = Number(item.unit_amount) || 0;
    return sum + (quantity * unitAmount);
  }, 0);

  const baseCents = Math.round(subtotalDollars * 100);
  const feeCents = passFeesToCustomer ? computeProcessingFeeCents(baseCents) : 0;
  const totalDollars = subtotalDollars + feeCents / 100;

  const handleSubmit = async (e: React.FormEvent) => {
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

    const formData = {
      customerId,
      lineItems: itemsInCents,
      dueDate: dueDate || undefined,
      description: description || undefined,
      footer: footer || undefined,
      memo: memo || undefined,
      passFeesToCustomer,
    };

    if (isEditMode && !existingInvoice.stripe_invoice_id) {
      // Edit local draft — await success before navigating
      try {
        await updateInvoiceAsync({ invoiceId: existingInvoice.id, ...formData });
        navigate(`/invoices/${existingInvoice.id}`);
      } catch {
        // Error toast handled by mutation's onError
      }
      return;
    } else if (isReadyForInvoicing) {
      // Create via Stripe
      createInvoice(formData);
    } else {
      // Save as local draft
      createLocalDraft(formData);
    }
  };

  const handleCustomerChange = (value: string) => {
    if (value === '__new__') {
      setShowCustomerForm(true);
    } else {
      setCustomerId(value);
    }
  };

  const isBusy = isCreating || isCreatingDraft || isUpdating;

  function getSubmitLabel(): string {
    if (isEditMode) return isBusy ? 'Saving...' : 'Save Changes';
    if (isReadyForInvoicing) return isBusy ? 'Creating...' : 'Create Invoice';
    return isBusy ? 'Saving...' : 'Save Draft';
  }

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
                  {isEditMode ? 'Edit Invoice' : 'Create Invoice'}
                </CardTitle>
                <CardDescription>
                  {isEditMode ? 'Update this draft invoice' : 'Create a new invoice for your customer'}
                </CardDescription>
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
                <Select value={customerId} onValueChange={handleCustomerChange}>
                  <SelectTrigger id="customer">
                    <SelectValue placeholder="Select a customer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__new__">
                      <span className="flex items-center gap-2">
                        <UserPlus className="h-4 w-4" />
                        New Customer
                      </span>
                    </SelectItem>
                    <Separator className="my-1" />
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

            {customerMissingEmail && (
              <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <div className="flex items-center gap-2 text-[13px]">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                  <span className="text-amber-800 dark:text-amber-200">
                    This customer doesn't have an email address. An email is required to send invoices.
                  </span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 h-8 text-[12px]"
                  onClick={() => setShowEditCustomerForm(true)}
                >
                  Add Email
                </Button>
              </div>
            )}

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
                      aria-label="Remove line item"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-6 pt-6 border-t">
              <div className="flex justify-between text-lg font-semibold">
                <span>Total:</span>
                <span>{formatCurrency(totalDollars)}</span>
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

            {/* Processing Fee Toggle */}
            <div className="rounded-xl border border-border/40 bg-muted/30 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-[14px] font-medium">Processing Fee</Label>
                  <p className="text-[13px] text-muted-foreground">
                    {passFeesToCustomer ? "Customer pays the processing fee" : "You absorb the processing fee"}
                  </p>
                </div>
                <Switch
                  checked={passFeesToCustomer}
                  onCheckedChange={setPassFeesToCustomer}
                  className="data-[state=checked]:bg-foreground"
                  aria-label="Pass processing fee to customer"
                />
              </div>
              {passFeesToCustomer && subtotalDollars > 0 && (
                <div className="mt-3 pt-3 border-t border-border/40 flex justify-between text-[13px]">
                  <span className="text-muted-foreground">Fee added to invoice</span>
                  <span className="font-medium">{formatCurrency(feeCents / 100)}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => navigate('/invoices')}>
            Cancel
          </Button>
          <Button type="submit" disabled={isBusy || !!customerMissingEmail}>
            {getSubmitLabel()}
          </Button>
        </div>
      </form>

      {/* Inline Customer Creation Dialog */}
      <CustomerFormDialog
        open={showCustomerForm}
        onOpenChange={setShowCustomerForm}
        onCreated={(customer) => setCustomerId(customer.id)}
      />

      {/* Edit Customer Dialog (for adding email) */}
      {selectedCustomer && (
        <CustomerFormDialog
          open={showEditCustomerForm}
          onOpenChange={setShowEditCustomerForm}
          customer={selectedCustomer}
        />
      )}
    </div>
  );
}
