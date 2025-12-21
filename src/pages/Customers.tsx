import { useState } from "react";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { useCustomers } from "@/hooks/useCustomers";
import { useStripeConnect } from "@/hooks/useStripeConnect";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, User, Mail, Phone, MapPin, Edit, Trash2, FileText, CreditCard } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CustomerFormDialog } from "@/components/invoicing/CustomerFormDialog";
import { useNavigate } from "react-router-dom";

export default function Customers() {
  const { selectedRestaurant } = useRestaurantContext();
  const { customers, loading, deleteCustomer } = useCustomers(selectedRestaurant?.restaurant_id || null);
  const { isReadyForInvoicing, createAccount, isCreatingAccount } = useStripeConnect(selectedRestaurant?.restaurant_id || null);
  const [searchTerm, setSearchTerm] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<any>(null);
  const [deletingCustomerId, setDeletingCustomerId] = useState<string | null>(null);
  const navigate = useNavigate();

  const filteredCustomers = customers.filter((customer) =>
    customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.phone?.includes(searchTerm)
  );

  const handleEdit = (customer: any) => {
    setEditingCustomer(customer);
    setIsFormOpen(true);
  };

  const handleDelete = (customerId: string) => {
    deleteCustomer(customerId);
    setDeletingCustomerId(null);
  };

  const handleCreateInvoice = (customerId: string) => {
    navigate(`/invoices/new?customer=${customerId}`);
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
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
              <User className="h-6 w-6 text-primary transition-transform duration-300 group-hover:scale-110" />
              <div>
                <CardTitle className="text-2xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                  Customers
                </CardTitle>
                <CardDescription>Manage your customer directory and create invoices</CardDescription>
              </div>
            </div>
            <Button onClick={() => { setEditingCustomer(null); setIsFormOpen(true); }}>
              <Plus className="h-4 w-4 mr-2" />
              Add Customer
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Stripe Connect Setup Banner */}
      {filteredCustomers.length > 0 && !isReadyForInvoicing && (
        <Alert>
          <CreditCard className="h-4 w-4" />
          <AlertTitle>Enable Invoice Payments</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              Set up Stripe Connect to create and send invoices with payment collection.
              Your customers can pay by credit card or US bank account (ACH).
            </p>
            <Button 
              onClick={() => createAccount('express')} 
              disabled={isCreatingAccount}
              size="sm"
            >
              {isCreatingAccount ? "Setting up..." : "Set up Stripe Connect"}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Search */}
      <Card>
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search customers..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* Customer List */}
      {filteredCustomers.length === 0 ? (
        <Card className="bg-gradient-to-br from-muted/50 to-transparent">
          <CardContent className="py-12 text-center">
            <User className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No customers found</h3>
            <p className="text-muted-foreground mb-4">
              {searchTerm ? "Try a different search term" : "Get started by adding your first customer. Once added, you can create and send invoices with payment collection."}
            </p>
            {!searchTerm && (
              <Button onClick={() => setIsFormOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Customer
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredCustomers.map((customer) => (
            <Card key={customer.id} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5 text-primary" />
                  {customer.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {customer.email && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Mail className="h-4 w-4" />
                    <span className="truncate">{customer.email}</span>
                  </div>
                )}
                {customer.phone && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Phone className="h-4 w-4" />
                    <span>{customer.phone}</span>
                  </div>
                )}
                {customer.billing_address_city && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <MapPin className="h-4 w-4" />
                    <span>
                      {customer.billing_address_city}
                      {customer.billing_address_state && `, ${customer.billing_address_state}`}
                    </span>
                  </div>
                )}
                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleCreateInvoice(customer.id)}
                    className="flex-1"
                  >
                    <FileText className="h-4 w-4 mr-1" />
                    Invoice
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleEdit(customer)}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDeletingCustomerId(customer.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Customer Form Dialog */}
      <CustomerFormDialog
        open={isFormOpen}
        onOpenChange={(open) => {
          setIsFormOpen(open);
          if (!open) setEditingCustomer(null);
        }}
        customer={editingCustomer}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deletingCustomerId} onOpenChange={(open) => !open && setDeletingCustomerId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Customer</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this customer? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deletingCustomerId && handleDelete(deletingCustomerId)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
