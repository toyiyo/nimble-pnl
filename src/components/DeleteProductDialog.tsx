import React from 'react';
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
import { AlertTriangle } from 'lucide-react';
import { Product } from '@/hooks/useProducts';

interface DeleteProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product | null;
  onConfirm: () => void;
}

export const DeleteProductDialog: React.FC<DeleteProductDialogProps> = ({
  open,
  onOpenChange,
  product,
  onConfirm,
}) => {
  if (!product) return null;

  const hasStock = (product.current_stock || 0) > 0;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Delete Product
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-3">
            <p>
              Are you sure you want to delete <strong>{product.name}</strong> from your inventory?
            </p>
            
            <div className="bg-muted p-3 rounded-lg space-y-2 text-sm">
              <p className="font-medium text-foreground">This action will:</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>Permanently remove the product from your inventory</li>
                <li>Delete all transaction history for this product</li>
                {hasStock && (
                  <li className="text-destructive font-medium">
                    Remove {product.current_stock} units currently in stock
                  </li>
                )}
              </ul>
            </div>

            {hasStock && (
              <div className="bg-destructive/10 border border-destructive/20 p-3 rounded-lg">
                <p className="text-destructive text-sm font-medium">
                  ⚠️ Warning: This product has {product.current_stock} units in stock. 
                  Consider transferring or counting the stock before deletion.
                </p>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              This action cannot be undone.
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col sm:flex-row gap-2">
          <AlertDialogCancel className="w-full sm:w-auto">Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="w-full sm:w-auto bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete Product
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};