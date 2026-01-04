import { format, subDays } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { History, Edit, CheckCircle, FileText, Calendar, DollarSign, RotateCcw } from 'lucide-react';
import { formatCurrencyFromCents } from '@/utils/tipPooling';
import { useTipSplits } from '@/hooks/useTipSplits';
import { useState } from 'react';
import { TipSplitAuditLog } from './TipSplitAuditLog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface RecentTipSplitsProps {
  restaurantId: string;
  onEditSplit: (splitId: string) => void;
  currentDate: string; // Selected date in YYYY-MM-DD format
}

export const RecentTipSplits = ({ restaurantId, onEditSplit, currentDate }: RecentTipSplitsProps) => {
  // Fetch last 30 days of splits
  const startDate = format(subDays(new Date(), 30), 'yyyy-MM-dd');
  const endDate = format(new Date(), 'yyyy-MM-dd');
  
  const { splits, isLoading, reopenSplit, isReopening } = useTipSplits(restaurantId, startDate, endDate);

  // Show all splits including today's entries
  const recentSplits = splits || [];

  // State for audit log dialog
  const [selectedSplitId, setSelectedSplitId] = useState<string | null>(null);

  const handleReopenSplit = (splitId: string) => {
    reopenSplit(splitId);
  };

  if (isLoading) {
    return (
      <Card className="bg-gradient-to-br from-muted/30 to-transparent">
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">Loading recent splits...</p>
        </CardContent>
      </Card>
    );
  }

  if (!recentSplits || recentSplits.length === 0) {
    return (
      <Card className="bg-gradient-to-br from-muted/30 to-transparent">
        <CardContent className="py-8 text-center">
          <History className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">No recent tip splits</p>
          <p className="text-sm text-muted-foreground mt-1">
            Recent tip splits will appear here
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <History className="h-6 w-6 text-primary" />
          <div>
            <CardTitle>Recent Tip Splits</CardTitle>
            <CardDescription>
              Last 30 days • {recentSplits.length} split{recentSplits.length === 1 ? '' : 's'}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {recentSplits.map((split) => {
            const isDraft = split.status === 'draft';
            const isApproved = split.status === 'approved';

            return (
              <div
                key={split.id}
                className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent/5 transition-colors"
              >
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    {isDraft && (
                      <Badge variant="outline" className="bg-yellow-500/10 text-yellow-700 border-yellow-500/20">
                        <FileText className="h-3 w-3 mr-1" />
                        Draft
                      </Badge>
                    )}
                    {isApproved && (
                      <Badge variant="outline" className="bg-green-500/10 text-green-700 border-green-500/20">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Approved
                      </Badge>
                    )}
                    <span className="text-sm text-muted-foreground flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {format(new Date(split.split_date + 'T12:00:00'), 'MMM d, yyyy')}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1">
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                      <span className="font-semibold">{formatCurrencyFromCents(split.total_amount)}</span>
                    </div>
                    <span className="text-sm text-muted-foreground">
                      • {split.items?.length || 0} employee{split.items?.length === 1 ? '' : 's'}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      • {split.share_method === 'hours' && 'Split by hours'}
                      {split.share_method === 'role' && 'Split by role'}
                      {split.share_method === 'manual' && 'Manual split'}
                    </span>
                  </div>
                </div>

                <div className="flex gap-2">
                  {isDraft && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onEditSplit(split.id)}
                    >
                      <Edit className="h-3 w-3 mr-1" />
                      Resume
                    </Button>
                  )}
                  {isApproved && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleReopenSplit(split.id)}
                        disabled={isReopening}
                        aria-label="Reopen split for editing"
                      >
                        <RotateCcw className="h-3 w-3 mr-1" />
                        Reopen
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedSplitId(split.id)}
                        aria-label="View audit trail"
                      >
                        View Details
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>

      {/* Audit Log Dialog */}
      <Dialog open={!!selectedSplitId} onOpenChange={() => setSelectedSplitId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tip Split Details</DialogTitle>
            <DialogDescription>
              View the complete history of changes for this tip split
            </DialogDescription>
          </DialogHeader>
          {selectedSplitId && <TipSplitAuditLog splitId={selectedSplitId} />}
        </DialogContent>
      </Dialog>
    </Card>
  );
};
