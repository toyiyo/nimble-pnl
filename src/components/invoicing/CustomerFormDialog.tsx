import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { useCustomers, type CustomerFormData } from "@/hooks/useCustomers";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface CustomerFormDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly customer?: any;
}

export function CustomerFormDialog({ open, onOpenChange, customer }: CustomerFormDialogProps) {
  const { selectedRestaurant } = useRestaurantContext();
  const { createCustomer, updateCustomer, isCreating, isUpdating } = useCustomers(selectedRestaurant?.restaurant_id || null);
  
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CustomerFormData>({
    defaultValues: customer || {},
  });

  useEffect(() => {
    if (customer) {
      reset(customer);
    } else {
      reset({
        name: "",
        email: "",
        phone: "",
        billing_address_line1: "",
        billing_address_line2: "",
        billing_address_city: "",
        billing_address_state: "",
        billing_address_postal_code: "",
        billing_address_country: "US",
        notes: "",
      });
    }
  }, [customer, reset]);

  const onSubmit = (data: CustomerFormData) => {
    if (customer) {
      updateCustomer({ id: customer.id, ...data });
    } else {
      createCustomer(data);
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{customer ? "Edit Customer" : "Add Customer"}</DialogTitle>
          <DialogDescription>
            {customer ? "Update customer information" : "Add a new customer to your directory"}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              {...register("name", { required: "Name is required" })}
              placeholder="Customer name"
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                {...register("email")}
                placeholder="customer@example.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                {...register("phone")}
                placeholder="(555) 123-4567"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="billing_address_line1">Address Line 1</Label>
            <Input
              id="billing_address_line1"
              {...register("billing_address_line1")}
              placeholder="Street address"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="billing_address_line2">Address Line 2</Label>
            <Input
              id="billing_address_line2"
              {...register("billing_address_line2")}
              placeholder="Apt, suite, unit, etc. (optional)"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="billing_address_city">City</Label>
              <Input
                id="billing_address_city"
                {...register("billing_address_city")}
                placeholder="City"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="billing_address_state">State</Label>
              <Input
                id="billing_address_state"
                {...register("billing_address_state")}
                placeholder="State"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="billing_address_postal_code">ZIP Code</Label>
              <Input
                id="billing_address_postal_code"
                {...register("billing_address_postal_code")}
                placeholder="ZIP"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              {...register("notes")}
              placeholder="Additional notes (optional)"
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isCreating || isUpdating}>
              {isCreating || isUpdating
                ? "Saving..."
                : customer
                  ? "Update"
                  : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
