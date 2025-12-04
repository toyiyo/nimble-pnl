import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, FileText, CheckCircle, Clock, Package, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/PageHeader';
import { usePurchaseOrders } from '@/hooks/usePurchaseOrders';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { PurchaseOrder, PurchaseOrderStatus } from '@/types/purchaseOrder';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

const statusConfig: Record<
  PurchaseOrderStatus,
  { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive'; icon: React.ElementType }
> = {
  DRAFT: { label: 'Draft', variant: 'secondary', icon: Clock },
  READY_TO_SEND: { label: 'Ready to Send', variant: 'default', icon: CheckCircle },
  SENT: { label: 'Sent', variant: 'outline', icon: FileText },
  PARTIALLY_RECEIVED: { label: 'Partially Received', variant: 'outline', icon: Package },
  RECEIVED: { label: 'Received', variant: 'default', icon: CheckCircle },
  CLOSED: { label: 'Closed', variant: 'secondary', icon: CheckCircle },
};

export const PurchaseOrders: React.FC = () => {
  const navigate = useNavigate();
  const { selectedRestaurant } = useRestaurantContext();
  const { purchaseOrders, loading, deletePurchaseOrder } = usePurchaseOrders();
  const [searchTerm, setSearchTerm] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);

  // Filter purchase orders
  const filteredPOs = useMemo(() => {
    if (!searchTerm) return purchaseOrders;

    const term = searchTerm.toLowerCase();
    return purchaseOrders.filter(
      (po) =>
        po.po_number?.toLowerCase().includes(term) ||
        po.supplier_name?.toLowerCase().includes(term) ||
        po.status.toLowerCase().includes(term)
    );
  }, [purchaseOrders, searchTerm]);

  const handleDelete = async () => {
    if (!selectedPO) return;
    await deletePurchaseOrder(selectedPO.id);
    setDeleteDialogOpen(false);
    setSelectedPO(null);
  };

  const handleRowClick = (po: PurchaseOrder) => {
    navigate(`/purchase-orders/${po.id}`);
  };

  const openDeleteDialog = (e: React.MouseEvent, po: PurchaseOrder) => {
    e.stopPropagation();
    setSelectedPO(po);
    setDeleteDialogOpen(true);
  };

  if (!selectedRestaurant) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Card className="w-96">
          <CardContent className="pt-6 text-center">
            <p className="text-muted-foreground">Please select a restaurant to view purchase orders</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchase Orders"
        icon={FileText}
      />

      {/* Header Card with Stats and Actions */}
      <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileText className="h-6 w-6 text-primary" />
              <div>
                <CardTitle className="text-2xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                  Purchase Orders
                </CardTitle>
                <CardDescription>Create and manage purchase orders</CardDescription>
              </div>
            </div>
            <Button onClick={() => navigate('/purchase-orders/new')}>
              <Plus className="h-4 w-4 mr-2" />
              New Purchase Order
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Search and Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by PO number, supplier, or status..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Purchase Orders Table */}
      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : filteredPOs.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No purchase orders found</h3>
              <p className="text-muted-foreground mb-4">
                {searchTerm ? 'Try adjusting your search terms.' : 'Get started by creating your first purchase order.'}
              </p>
              {!searchTerm && (
                <Button onClick={() => navigate('/purchase-orders/new')}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Purchase Order
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO Number</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Order Total</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPOs.map((po) => {
                  const statusInfo = statusConfig[po.status];
                  const StatusIcon = statusInfo.icon;

                  return (
                    <TableRow
                      key={po.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => handleRowClick(po)}
                    >
                      <TableCell className="font-medium">{po.po_number || 'N/A'}</TableCell>
                      <TableCell>{po.supplier_name || 'Multiple Suppliers'}</TableCell>
                      <TableCell>
                        <Badge variant={statusInfo.variant} className="gap-1">
                          <StatusIcon className="h-3 w-3" />
                          {statusInfo.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        ${po.total.toFixed(2)}
                      </TableCell>
                      <TableCell>{format(new Date(po.created_at), 'MMM d, yyyy')}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => openDeleteDialog(e, po)}
                          aria-label={`Delete purchase order ${po.po_number}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Purchase Order</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete purchase order {selectedPO?.po_number}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default PurchaseOrders;
