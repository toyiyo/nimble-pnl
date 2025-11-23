import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useShiftClaims } from '@/hooks/useShiftClaims';
import { useCreateShiftApproval } from '@/hooks/useShiftApprovals';
import { useAuth } from '@/hooks/useAuth';
import { format } from 'date-fns';
import { 
  Calendar, 
  Clock, 
  User, 
  CheckCircle,
  XCircle,
  MessageSquare,
  AlertCircle,
  ArrowRight,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

interface ShiftApprovalWorkflowProps {
  restaurantId: string;
}

export const ShiftApprovalWorkflow = ({ restaurantId }: ShiftApprovalWorkflowProps) => {
  const { user } = useAuth();
  const { shiftClaims, loading } = useShiftClaims(restaurantId, 'pending');
  const createApproval = useCreateShiftApproval();

  const [approvalDialogOpen, setApprovalDialogOpen] = useState(false);
  const [selectedClaim, setSelectedClaim] = useState<string | null>(null);
  const [decision, setDecision] = useState<'approved' | 'rejected'>('approved');
  const [notes, setNotes] = useState('');
  const [processing, setProcessing] = useState(false);

  const handleOpenApproval = (claimId: string, isApproval: boolean) => {
    setSelectedClaim(claimId);
    setDecision(isApproval ? 'approved' : 'rejected');
    setApprovalDialogOpen(true);
  };

  const handleSubmitDecision = async () => {
    if (!selectedClaim || !user) return;
    
    setProcessing(true);
    try {
      await createApproval.mutateAsync({
        restaurant_id: restaurantId,
        shift_claim_id: selectedClaim,
        approved_by: user.id,
        decision,
        notes: notes || undefined,
      });
      
      setApprovalDialogOpen(false);
      setNotes('');
      setSelectedClaim(null);
    } catch (error) {
      console.error('Error processing approval:', error);
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <>
      <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
        <CardHeader>
          <div className="flex items-center gap-3">
            <CheckCircle className="h-6 w-6 text-primary" />
            <div>
              <CardTitle className="text-2xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                Shift Claim Requests
              </CardTitle>
              <CardDescription>
                Review and approve or reject shift claim requests
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {shiftClaims.length === 0 ? (
            <div className="text-center py-12">
              <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Pending Requests</h3>
              <p className="text-muted-foreground">
                All shift claim requests have been processed.
              </p>
            </div>
          ) : (
            shiftClaims.map((claim) => {
              const isOfferClaim = !!claim.shift_offer;
              const shift = isOfferClaim ? claim.shift_offer?.shift : claim.open_shift;
              
              return (
                <Card key={claim.id} className="border-yellow-500/20 bg-yellow-500/5">
                  <CardContent className="pt-6">
                    <div className="space-y-4">
                      {/* Header */}
                      <div className="flex items-center justify-between">
                        <div>
                          <Badge className="bg-gradient-to-r from-yellow-500 to-orange-500">
                            Pending Approval
                          </Badge>
                        </div>
                        <span className="text-sm text-muted-foreground">
                          {format(new Date(claim.created_at), 'MMM d, h:mm a')}
                        </span>
                      </div>

                      {/* Claim Details */}
                      <div className="grid md:grid-cols-2 gap-4">
                        {/* From (if shift trade) */}
                        {isOfferClaim && claim.shift_offer?.offering_employee && (
                          <div className="space-y-2">
                            <div className="text-sm font-semibold text-muted-foreground">
                              Offered By
                            </div>
                            <div className="flex items-center gap-2">
                              <User className="h-4 w-4 text-primary" />
                              <span>{claim.shift_offer.offering_employee.name}</span>
                            </div>
                          </div>
                        )}

                        {/* To */}
                        <div className="space-y-2">
                          <div className="text-sm font-semibold text-muted-foreground">
                            {isOfferClaim ? 'Claimed By' : 'Employee'}
                          </div>
                          <div className="flex items-center gap-2">
                            <User className="h-4 w-4 text-primary" />
                            <span>{claim.claiming_employee?.name}</span>
                          </div>
                        </div>
                      </div>

                      {/* Shift Details */}
                      {shift && (
                        <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                          <div className="flex items-center gap-2 text-sm">
                            <Calendar className="h-4 w-4 text-primary" />
                            <span className="font-semibold">
                              {format(new Date(shift.start_time), 'EEEE, MMMM d, yyyy')}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-sm">
                            <Clock className="h-4 w-4 text-muted-foreground" />
                            <span>
                              {format(new Date(shift.start_time), 'h:mm a')} - {format(new Date(shift.end_time), 'h:mm a')}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-sm">
                            <User className="h-4 w-4 text-muted-foreground" />
                            <span>Position: {shift.position}</span>
                          </div>
                        </div>
                      )}

                      {/* Employee Message */}
                      {claim.message && (
                        <div className="flex items-start gap-2 text-sm bg-muted/30 rounded-lg p-3">
                          <MessageSquare className="h-4 w-4 text-muted-foreground mt-0.5" />
                          <div>
                            <div className="font-semibold mb-1">Employee Message:</div>
                            <div className="text-muted-foreground">{claim.message}</div>
                          </div>
                        </div>
                      )}

                      {/* Action Buttons */}
                      <div className="flex gap-3 justify-end pt-4 border-t">
                        <Button
                          variant="outline"
                          onClick={() => handleOpenApproval(claim.id, false)}
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          <XCircle className="h-4 w-4 mr-2" />
                          Reject
                        </Button>
                        <Button
                          onClick={() => handleOpenApproval(claim.id, true)}
                          className="bg-gradient-to-r from-green-500 to-emerald-600"
                        >
                          <CheckCircle className="h-4 w-4 mr-2" />
                          Approve
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* Approval/Rejection Dialog */}
      <AlertDialog open={approvalDialogOpen} onOpenChange={setApprovalDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {decision === 'approved' ? 'Approve' : 'Reject'} Shift Claim
            </AlertDialogTitle>
            <AlertDialogDescription>
              {decision === 'approved' 
                ? 'This will reassign the shift to the claiming employee.'
                : 'The shift will remain with the original employee and the claim will be rejected.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="notes">Notes (Optional)</Label>
              <Textarea
                id="notes"
                placeholder={`Add notes about this ${decision}...`}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={processing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleSubmitDecision}
              disabled={processing}
              className={
                decision === 'approved'
                  ? 'bg-gradient-to-r from-green-500 to-emerald-600'
                  : 'bg-gradient-to-r from-red-500 to-rose-600'
              }
            >
              {processing ? 'Processing...' : `Confirm ${decision === 'approved' ? 'Approval' : 'Rejection'}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
