import { format } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FileText, Edit, Trash2, Calendar } from 'lucide-react';
import { formatCurrencyFromCents } from '@/utils/tipPooling';
import { useTipSplits } from '@/hooks/useTipSplits';
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
import { useState } from 'react';

interface TipDraftsListProps {
  restaurantId: string;
  onResumeDraft: (draftId: string) => void;
}

export const TipDraftsList = ({ restaurantId, onResumeDraft }: TipDraftsListProps) => {
  const { splits, isLoading, deleteTipSplitAsync, isDeleting } = useTipSplits(restaurantId);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [draftToDelete, setDraftToDelete] = useState<string | null>(null);

  // Filter for drafts only
  const drafts = splits?.filter(s => s.status === 'draft') || [];

  const handleDelete = async () => {
    if (!draftToDelete) return;
    try {
      await deleteTipSplitAsync(draftToDelete);
    } catch {
      // Error handled by hook's onError callback
      return;
    }
    setDeleteDialogOpen(false);
    setDraftToDelete(null);
  };

  const confirmDelete = (draftId: string) => {
    setDraftToDelete(draftId);
    setDeleteDialogOpen(true);
  };

  if (isLoading) {
    return (
      <Card className="bg-gradient-to-br from-muted/30 to-transparent">
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">Loading drafts...</p>
        </CardContent>
      </Card>
    );
  }

  if (!drafts || drafts.length === 0) {
    return (
      <Card className="bg-gradient-to-br from-muted/30 to-transparent">
        <CardContent className="py-8 text-center">
          <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">No saved drafts</p>
          <p className="text-sm text-muted-foreground mt-1">
            Drafts appear here when you save a tip split without approving it.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <FileText className="h-6 w-6 text-primary" />
            <div>
              <CardTitle>Saved Drafts</CardTitle>
              <CardDescription>
                {drafts.length} draft{drafts.length !== 1 ? 's' : ''} waiting for approval
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {drafts.map((split) => (
              <div
                key={split.id}
                className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent/5 transition-colors"
              >
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="bg-yellow-500/10 text-yellow-700 border-yellow-500/20">
                      Draft
                    </Badge>
                    <span className="text-sm text-muted-foreground flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {format(new Date(split.split_date), 'MMM d, yyyy')}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <p className="text-2xl font-bold">
                      {formatCurrencyFromCents(split.total_amount)}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {split.share_method === 'hours' && 'Split by hours'}
                      {split.share_method === 'role' && 'Split by role'}
                      {split.share_method === 'manual' && 'Manual allocation'}
                      {!split.share_method && 'Split evenly'}
                    </p>
                  </div>
                  {split.notes && (
                    <p className="text-sm text-muted-foreground italic">"{split.notes}"</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onResumeDraft(split.id)}
                    aria-label={`Resume draft from ${format(new Date(split.split_date), 'MMM d, yyyy')}`}
                  >
                    <Edit className="h-4 w-4 mr-1" />
                    Resume
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => confirmDelete(split.id)}
                    aria-label={`Delete draft from ${format(new Date(split.split_date), 'MMM d, yyyy')}`}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete draft?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this draft tip split. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDelete} 
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
