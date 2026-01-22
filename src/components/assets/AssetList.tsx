import { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { Progress } from '@/components/ui/progress';
import {
  MoreHorizontal,
  Edit,
  Trash2,
  Archive,
  Image,
  Calculator,
  MapPin,
  Calendar,
} from 'lucide-react';
import type { AssetWithDetails, AssetStatus } from '@/types/assets';
import { formatAssetCurrency } from '@/types/assets';

interface AssetListProps {
  assets: AssetWithDetails[];
  isLoading: boolean;
  onEdit: (asset: AssetWithDetails) => void;
  onDispose: (asset: AssetWithDetails) => void;
  onDelete: (assetId: string) => void;
  onViewPhotos: (asset: AssetWithDetails) => void;
  onDepreciate: (asset: AssetWithDetails) => void;
}

const statusColors: Record<AssetStatus, string> = {
  active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
  disposed: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
  fully_depreciated: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
};

const statusLabels: Record<AssetStatus, string> = {
  active: 'Active',
  disposed: 'Disposed',
  fully_depreciated: 'Fully Depreciated',
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function AssetList({
  assets,
  isLoading,
  onEdit,
  onDispose,
  onDelete,
  onViewPhotos,
  onDepreciate,
}: AssetListProps) {
  const [deleteAssetId, setDeleteAssetId] = useState<string | null>(null);

  const handleConfirmDelete = () => {
    if (deleteAssetId) {
      onDelete(deleteAssetId);
      setDeleteAssetId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (assets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="rounded-full bg-muted p-4 mb-4">
          <Archive className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-medium">No assets yet</h3>
        <p className="text-muted-foreground mt-1">
          Add your first asset to start tracking equipment and depreciation.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Asset</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Purchase Cost</TableHead>
              <TableHead className="text-right">Net Book Value</TableHead>
              <TableHead>Depreciation</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {assets.map((asset) => (
              <TableRow key={asset.id}>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium">{asset.name}</span>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      {asset.location_name && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {asset.location_name}
                        </span>
                      )}
                      {asset.serial_number && (
                        <span className="text-xs">SN: {asset.serial_number}</span>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{asset.category}</Badge>
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatAssetCurrency(asset.purchase_cost)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatAssetCurrency(asset.net_book_value)}
                </TableCell>
                <TableCell>
                  <div className="w-32">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span>{Math.round(asset.depreciation_percentage)}%</span>
                      <span className="text-muted-foreground">
                        {asset.remaining_useful_life_months}mo left
                      </span>
                    </div>
                    <Progress value={asset.depreciation_percentage} className="h-2" />
                  </div>
                </TableCell>
                <TableCell>
                  <Badge className={statusColors[asset.status]}>
                    {statusLabels[asset.status]}
                  </Badge>
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label="Asset actions">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onEdit(asset)}>
                        <Edit className="h-4 w-4 mr-2" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onViewPhotos(asset)}>
                        <Image className="h-4 w-4 mr-2" />
                        Photos
                      </DropdownMenuItem>
                      {asset.status === 'active' && (
                        <>
                          <DropdownMenuItem onClick={() => onDepreciate(asset)}>
                            <Calculator className="h-4 w-4 mr-2" />
                            Run Depreciation
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => onDispose(asset)}>
                            <Archive className="h-4 w-4 mr-2" />
                            Dispose
                          </DropdownMenuItem>
                        </>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => setDeleteAssetId(asset.id)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={!!deleteAssetId} onOpenChange={() => setDeleteAssetId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Asset</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this asset? This action cannot be undone and
              will remove all photos and depreciation history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
