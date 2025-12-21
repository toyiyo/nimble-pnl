import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { useInvoices, type InvoiceStatus } from "@/hooks/useInvoices";
import { useStripeConnect } from "@/hooks/useStripeConnect";
import { useCustomers } from "@/hooks/useCustomers";
import { StripeEmbeddedOnboarding } from "@/components/StripeEmbeddedOnboarding";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, FileText, AlertCircle, CheckCircle, Clock, XCircle, Ban, Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useNavigate, useSearchParams } from "react-router-dom";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

export default function Invoices() {
  const { selectedRestaurant } = useRestaurantContext();
  const { invoices, loading } = useInvoices(selectedRestaurant?.restaurant_id || null);
  const { connectedAccount, isReadyForInvoicing, createAccount, isCreatingAccount } = useStripeConnect(selectedRestaurant?.restaurant_id || null);
  const { customers } = useCustomers(selectedRestaurant?.restaurant_id || null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'all'>('all');
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    const success = searchParams.get('success') === 'true';
    const refresh = searchParams.get('refresh') === 'true';

    if (!success && !refresh) return;

    if (success) {
      toast({
        title: "Stripe Setup Complete",
        description: "Your Stripe Connect account has been successfully configured. You can now create and send invoices.",
      });
      queryClient.invalidateQueries({ queryKey: ['stripe-connected-account', selectedRestaurant?.restaurant_id] });
      searchParams.delete('success');
    }

    if (refresh) {
      toast({
        title: "Setup Incomplete",
        description: "Please complete your Stripe Connect onboarding to start creating invoices.",
        variant: "destructive",
      });
      searchParams.delete('refresh');
    }

    setSearchParams(searchParams);
  }, [queryClient, searchParams, selectedRestaurant?.restaurant_id, setSearchParams, toast]);

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredInvoices = invoices.filter((invoice) => {
    const name = invoice.customers?.name?.toLowerCase() || "";
    const email = invoice.customers?.email?.toLowerCase() || "";
    const number = invoice.invoice_number?.toLowerCase() || "";

    const matchesSearch =
      normalizedSearch === "" ||
      number.includes(normalizedSearch) ||
      name.includes(normalizedSearch) ||
      email.includes(normalizedSearch);

    const matchesStatus = statusFilter === 'all' || invoice.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const getStatusBadge = (status: InvoiceStatus) => {
    switch (status) {
      case 'draft':
        return <Badge variant="outline"><Clock className="w-3 h-3 mr-1" />Draft</Badge>;
      case 'open':
        return <Badge className="bg-blue-500"><AlertCircle className="w-3 h-3 mr-1" />Open</Badge>;
      case 'paid':
        return <Badge className="bg-green-500"><CheckCircle className="w-3 h-3 mr-1" />Paid</Badge>;
      case 'void':
        return <Badge variant="secondary"><XCircle className="w-3 h-3 mr-1" />Void</Badge>;
      case 'uncollectible':
        return <Badge variant="destructive"><Ban className="w-3 h-3 mr-1" />Uncollectible</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // Show initial setup message when no customers exist
  if (customers.length === 0) {
    return (
      <div className="space-y-6">
        <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
          <CardHeader>
            <div className="flex items-center gap-3">
              <FileText className="h-6 w-6 text-primary" />
              <div>
                <CardTitle className="text-2xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                  Invoices
                </CardTitle>
                <CardDescription>Create and manage invoices with card + ACH payments</CardDescription>
              </div>
            </div>
          </CardHeader>
        </Card>

        <Alert>
          <Users className="h-4 w-4" />
          <AlertTitle>Get Started with Invoicing</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              To create invoices, you first need to add customers to your directory.
              Once you have customers, you can create professional invoices with payment collection.
            </p>
            <div className="flex gap-3 flex-col md:flex-row">
              <Button onClick={() => navigate('/customers')} className="flex-1">
                <Users className="h-4 w-4 mr-2" />
                Add Customers
              </Button>
              {!connectedAccount && (
                <Button 
                  onClick={() => createAccount('express')} 
                  disabled={isCreatingAccount}
                  variant="outline"
                  className="flex-1"
                >
                  {isCreatingAccount ? "Setting up..." : "Set up Payments"}
                </Button>
              )}
            </div>
            {connectedAccount && !isReadyForInvoicing && (
              <StripeEmbeddedOnboarding
                restaurantId={selectedRestaurant?.restaurant_id || null}
                onCompleted={() => {
                  queryClient.invalidateQueries({ queryKey: ['stripe-connected-account', selectedRestaurant?.restaurant_id] });
                  queryClient.invalidateQueries({ queryKey: ['invoices', selectedRestaurant?.restaurant_id] });
                }}
              />
            )}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Show Stripe Connect setup if not configured
  if (!connectedAccount) {
    return (
      <div className="space-y-6">
        <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
          <CardHeader>
            <div className="flex items-center gap-3">
              <FileText className="h-6 w-6 text-primary" />
              <div>
                <CardTitle className="text-2xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                  Invoices
                </CardTitle>
                <CardDescription>Create and manage invoices with card + ACH payments</CardDescription>
              </div>
            </div>
          </CardHeader>
        </Card>

        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Stripe Connect Setup Required</AlertTitle>
          <AlertDescription>
            To create invoices and accept payments, you need to set up a Stripe Connect account.
            This allows your customers to pay by credit card or US bank account (ACH).
          </AlertDescription>
        </Alert>

        <Card>
          <CardContent className="pt-6">
            <div className="text-center space-y-4">
              <h3 className="text-lg font-semibold">Get Started with Stripe Connect</h3>
              <p className="text-muted-foreground">
                Stripe Connect is a secure payment processing platform that allows you to accept payments directly.
                Funds will be deposited into your bank account.
              </p>
              <Button onClick={() => createAccount('express')} disabled={isCreatingAccount}>
                {isCreatingAccount ? "Setting up..." : "Set Up Stripe Connect"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show onboarding incomplete message
  if (!isReadyForInvoicing && connectedAccount) {
    return (
      <div className="space-y-6">
        <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
          <CardHeader>
            <div className="flex items-center gap-3">
              <FileText className="h-6 w-6 text-primary" />
              <div>
                <CardTitle className="text-2xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                  Invoices
                </CardTitle>
                <CardDescription>Create and manage invoices with card + ACH payments</CardDescription>
              </div>
            </div>
          </CardHeader>
        </Card>

        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Complete Stripe Onboarding</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              Your Stripe Connect account was created but onboarding wasn't completed.
              Please finish the setup process to start creating invoices.
            </p>
            <StripeEmbeddedOnboarding
              restaurantId={selectedRestaurant?.restaurant_id || null}
              onCompleted={() => {
                queryClient.invalidateQueries({ queryKey: ['stripe-connected-account', selectedRestaurant?.restaurant_id] });
                queryClient.invalidateQueries({ queryKey: ['invoices', selectedRestaurant?.restaurant_id] });
              }}
            />
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileText className="h-6 w-6 text-primary transition-transform duration-300 group-hover:scale-110" />
              <div>
                <CardTitle className="text-2xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                  Invoices
                </CardTitle>
                <CardDescription>Create and manage invoices for your customers</CardDescription>
              </div>
            </div>
            <Button onClick={() => navigate('/invoices/new')}>
              <Plus className="h-4 w-4 mr-2" />
              Create Invoice
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search invoices..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              variant={statusFilter === 'all' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter('all')}
            >
              All
            </Button>
            <Button
              variant={statusFilter === 'draft' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter('draft')}
            >
              Draft
            </Button>
            <Button
              variant={statusFilter === 'open' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter('open')}
            >
              Open
            </Button>
            <Button
              variant={statusFilter === 'paid' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter('paid')}
            >
              Paid
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Invoice List */}
      {filteredInvoices.length === 0 ? (
        <Card className="bg-gradient-to-br from-muted/50 to-transparent">
          <CardContent className="py-12 text-center">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No invoices found</h3>
            <p className="text-muted-foreground mb-4">
              {searchTerm || statusFilter !== 'all'
                ? "Try a different search or filter"
                : "Get started by creating your first invoice"}
            </p>
            {!searchTerm && statusFilter === 'all' && (
              <Button onClick={() => navigate('/invoices/new')}>
                <Plus className="h-4 w-4 mr-2" />
                Create Invoice
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {filteredInvoices.map((invoice) => (
                <button
                  type="button"
                  key={invoice.id}
                  className="w-full text-left p-4 hover:bg-muted/50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onClick={() => navigate(`/invoices/${invoice.id}`)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="font-semibold">
                          {invoice.invoice_number || "Draft"}
                        </span>
                        {getStatusBadge(invoice.status)}
                      </div>
                      <div className="text-sm text-muted-foreground space-y-1">
                        <div>{invoice.customers?.name}</div>
                        <div>Due: {invoice.due_date ? new Date(invoice.due_date).toLocaleDateString() : "Not set"}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-semibold">
                        {formatCurrency(invoice.total / 100)}
                      </div>
                      {invoice.status === 'paid' && invoice.paid_at && (
                        <div className="text-xs text-muted-foreground">
                          Paid {new Date(invoice.paid_at).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
