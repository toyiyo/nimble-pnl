import { useState, useRef, useCallback, useMemo } from 'react';
import { format } from 'date-fns';
import { parseDateLocal } from '@/lib/dateUtils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  useShiftTrades,
  useApproveShiftTrade,
  useRejectShiftTrade,
  useDeleteShiftTrade,
  ShiftTrade,
} from '@/hooks/useShiftTrades';
import {
  useOpenShiftClaims,
  useApproveClaimMutation,
  useRejectClaimMutation,
  OpenShiftClaimWithJoins,
} from '@/hooks/useOpenShiftClaims';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { supabase } from '@/integrations/supabase/client';
import { isTradeExpired } from '@/lib/shiftTradeStatus';
import {
  CheckCircle,
  XCircle,
  Clock,
  ArrowRight,
  Loader2,
  AlertCircle,
  FileText,
  ChevronDown,
  ShoppingBag,
  Trash2,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

type ActionType = 'approve' | 'reject' | null;

/**
 * Discriminated union for the single confirm-dialog used by the cleanup UI.
 * - 'single': manager clicks Remove on one expired/stale trade
 * - 'bulk': manager clicks "Remove all expired (N)"
 */
type ConfirmTarget =
  | { type: 'single'; trade: ShiftTrade }
  | { type: 'bulk'; ids: string[] }
  | null;

function renderClaimButtonContent(action: ActionType, isPending: boolean) {
  if (isPending) {
    return (
      <>
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Processing...
      </>
    );
  }
  if (action === 'approve') {
    return (
      <>
        <CheckCircle className="mr-2 h-4 w-4" />
        Approve
      </>
    );
  }
  return (
    <>
      <XCircle className="mr-2 h-4 w-4" />
      Reject
    </>
  );
}

interface TradeApprovalQueueProps {
  /** Injectable for testing; defaults to `new Date()` when omitted. */
  now?: Date;
}

export const TradeApprovalQueue = ({ now: nowProp }: TradeApprovalQueueProps = {}) => {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id || null;

  /** The "current time" used for expiry checks. Injectable for tests. */
  const now = useMemo(() => nowProp ?? new Date(), [nowProp]);

  // Fetch both pending_approval and open trades
  const { trades: pendingTrades, loading: pendingLoading } = useShiftTrades(
    restaurantId,
    'pending_approval',
    null
  );
  const { trades: openTrades, loading: openLoading } = useShiftTrades(
    restaurantId,
    'open',
    null
  );

  // Fetch open shift claims
  const { claims: allClaims, loading: claimsLoading } = useOpenShiftClaims(restaurantId);
  const pendingClaims = allClaims.filter((c) => c.status === 'pending_approval');

  const { mutate: approveTrade, isPending: isApproving } = useApproveShiftTrade();
  const { mutate: rejectTrade, isPending: isRejecting } = useRejectShiftTrade();
  const { mutate: approveClaim, isPending: isApprovingClaim } = useApproveClaimMutation();
  const { mutate: rejectClaim, isPending: isRejectingClaim } = useRejectClaimMutation();

  const [selectedTrade, setSelectedTrade] = useState<ShiftTrade | null>(null);
  const [actionType, setActionType] = useState<ActionType>(null);
  const [managerNote, setManagerNote] = useState('');
  const [openSectionExpanded, setOpenSectionExpanded] = useState(true);

  // Claim dialog state
  const [selectedClaim, setSelectedClaim] = useState<OpenShiftClaimWithJoins | null>(null);
  const [claimActionType, setClaimActionType] = useState<ActionType>(null);
  const [claimNote, setClaimNote] = useState('');

  // -------------------------------------------------------------------------
  // Cleanup UI state (manager removes stale/expired trades)
  // -------------------------------------------------------------------------

  /**
   * Tracks IDs of trades whose delete is in-flight.
   * Updated in onSettled (not onSuccess) so a failed delete still clears the spinner.
   */
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  /**
   * Single confirm dialog for both single-remove and bulk-remove actions.
   * null = dialog is closed.
   */
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget>(null);

  /**
   * Ref for focus restoration: "Remove all expired" / section header button.
   * After the bulk confirm dialog closes (which unmounts rows), we return focus
   * here so keyboard users aren't stranded on an unmounted element.
   */
  const bulkRemoveBtnRef = useRef<HTMLButtonElement>(null);

  const { mutate: deleteTrade } = useDeleteShiftTrade();

  /** Partition open trades in a single pass. */
  const { expiredOpen, activeOpen } = useMemo(() => {
    const expiredOpen: ShiftTrade[] = [];
    const activeOpen: ShiftTrade[] = [];
    for (const t of openTrades) {
      if (isTradeExpired(t.offered_shift?.start_time, now)) {
        expiredOpen.push(t);
      } else {
        activeOpen.push(t);
      }
    }
    return { expiredOpen, activeOpen };
  }, [openTrades, now]);

  /**
   * Partition pending trades in a single pass.
   * Stale = ghost (null accepted_by) OR expired shift date.
   * Render stale trades in a "Needs cleanup" section; normal in the approve/reject section.
   */
  const { stalePending, normalPending } = useMemo(() => {
    const stalePending: ShiftTrade[] = [];
    const normalPending: ShiftTrade[] = [];
    for (const t of pendingTrades) {
      if (!t.accepted_by || isTradeExpired(t.offered_shift?.start_time, now)) {
        stalePending.push(t);
      } else {
        normalPending.push(t);
      }
    }
    return { stalePending, normalPending };
  }, [pendingTrades, now]);

  /** All stale IDs for the bulk action. */
  const allStaleIds = useMemo(
    () => [...expiredOpen, ...stalePending].map((t) => t.id),
    [expiredOpen, stalePending]
  );

  const handleRemoveSingle = useCallback((trade: ShiftTrade) => {
    setConfirmTarget({ type: 'single', trade });
  }, []);

  const handleRemoveBulk = useCallback(() => {
    setConfirmTarget({ type: 'bulk', ids: allStaleIds });
  }, [allStaleIds]);

  const handleConfirmRemove = useCallback(() => {
    if (!confirmTarget) return;

    const idsToDelete =
      confirmTarget.type === 'single' ? [confirmTarget.trade.id] : confirmTarget.ids;

    for (const tradeId of idsToDelete) {
      setDeletingIds((prev) => new Set([...prev, tradeId]));
      deleteTrade(
        { tradeId },
        {
          onSettled: () => {
            setDeletingIds((prev) => {
              const next = new Set(prev);
              next.delete(tradeId);
              return next;
            });
          },
        }
      );
    }

    setConfirmTarget(null);

    // Restore focus after bulk removal (rows are unmounted)
    if (confirmTarget.type === 'bulk') {
      requestAnimationFrame(() => {
        bulkRemoveBtnRef.current?.focus();
      });
    }
  }, [confirmTarget, deleteTrade]);

  const handleCancelRemove = useCallback(() => {
    setConfirmTarget(null);
  }, []);

  const loading = pendingLoading || openLoading || claimsLoading;

  const handleAction = (trade: ShiftTrade, action: 'approve' | 'reject') => {
    setSelectedTrade(trade);
    setActionType(action);
    setManagerNote('');
  };

  const handleConfirm = async () => {
    if (!selectedTrade || !actionType) return;

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) {
      console.error('No authenticated user');
      return;
    }

    const payload = {
      tradeId: selectedTrade.id,
      managerNote: managerNote || undefined,
      managerUserId: user.id,
    };

    if (actionType === 'approve') {
      approveTrade(payload, {
        onSuccess: () => {
          setSelectedTrade(null);
          setActionType(null);
          setManagerNote('');
        },
      });
    } else {
      rejectTrade(payload, {
        onSuccess: () => {
          setSelectedTrade(null);
          setActionType(null);
          setManagerNote('');
        },
      });
    }
  };

  const handleCancel = () => {
    setSelectedTrade(null);
    setActionType(null);
    setManagerNote('');
  };

  const handleClaimAction = (claim: OpenShiftClaimWithJoins, action: 'approve' | 'reject') => {
    setSelectedClaim(claim);
    setClaimActionType(action);
    setClaimNote('');
  };

  const handleClaimConfirm = () => {
    if (!selectedClaim || !claimActionType) return;
    const payload = { claimId: selectedClaim.id, note: claimNote || undefined };
    if (claimActionType === 'approve') {
      approveClaim(payload, {
        onSuccess: () => {
          setSelectedClaim(null);
          setClaimActionType(null);
          setClaimNote('');
        },
      });
    } else {
      rejectClaim(payload, {
        onSuccess: () => {
          setSelectedClaim(null);
          setClaimActionType(null);
          setClaimNote('');
        },
      });
    }
  };

  const handleClaimCancel = () => {
    setSelectedClaim(null);
    setClaimActionType(null);
    setClaimNote('');
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  const hasNormalPending = normalPending.length > 0;
  const hasStalePending = stalePending.length > 0;
  const hasOpenTrades = openTrades.length > 0;
  const hasExpiredOpen = expiredOpen.length > 0;
  const hasActiveOpen = activeOpen.length > 0;
  const hasPendingClaims = pendingClaims.length > 0;
  const hasAnyStale = allStaleIds.length > 0;

  return (
    <div className="space-y-6">
      {/* Pending Shift Claims Section */}
      {hasPendingClaims && (
        <>
          <Card className="border-green-200 bg-gradient-to-br from-green-50 via-emerald-50 to-transparent dark:border-green-800 dark:from-green-950/20 dark:via-emerald-950/20">
            <CardHeader>
              <div className="flex items-center gap-3">
                <CheckCircle className="h-6 w-6 text-green-600 dark:text-green-400" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-2xl text-green-900 dark:text-green-100">
                      Pending Shift Claims
                    </CardTitle>
                    <Badge className="bg-green-500">{pendingClaims.length}</Badge>
                  </div>
                  <CardDescription className="text-green-700 dark:text-green-300">
                    Employees requesting to claim open shifts
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
          </Card>

          <div className="space-y-4">
            {pendingClaims.map((claim) => (
              <ClaimRequestCard
                key={claim.id}
                claim={claim}
                onApprove={() => handleClaimAction(claim, 'approve')}
                onReject={() => handleClaimAction(claim, 'reject')}
                disabled={isApprovingClaim || isRejectingClaim}
              />
            ))}
          </div>
        </>
      )}

      {/* Pending Approval Section */}
      <Card className="border-amber-200 bg-gradient-to-br from-amber-50 via-orange-50 to-transparent dark:border-amber-800 dark:from-amber-950/20 dark:via-orange-950/20">
        <CardHeader>
          <div className="flex items-center gap-3">
            <Clock className="h-6 w-6 text-amber-600 dark:text-amber-400" />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <CardTitle className="text-2xl text-amber-900 dark:text-amber-100">
                  Pending Approval
                </CardTitle>
                {hasNormalPending && (
                  <Badge className="bg-amber-500">{normalPending.length}</Badge>
                )}
              </div>
              <CardDescription className="text-amber-700 dark:text-amber-300">
                Trades accepted by employees awaiting your approval
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      {hasNormalPending ? (
        <div className="space-y-4">
          {normalPending.map((trade) => (
            <TradeRequestCard
              key={trade.id}
              trade={trade}
              onApprove={() => handleAction(trade, 'approve')}
              onReject={() => handleAction(trade, 'reject')}
              disabled={isApproving || isRejecting}
            />
          ))}
        </div>
      ) : (
        <Card className="bg-gradient-to-br from-muted/50 to-transparent">
          <CardContent className="py-8 text-center">
            <CheckCircle className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <h3 className="mb-1 text-base font-semibold">No pending approvals</h3>
            <p className="text-sm text-muted-foreground">No trades awaiting your decision.</p>
          </CardContent>
        </Card>
      )}

      {/* Stale Pending (Needs cleanup) Section */}
      {hasStalePending && (
        <div className="space-y-2">
          <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider px-1">
            Needs cleanup
          </p>
          {stalePending.map((trade) => (
            <StalePendingRow
              key={trade.id}
              trade={trade}
              isRemoving={deletingIds.has(trade.id)}
              onRemove={() => handleRemoveSingle(trade)}
            />
          ))}
        </div>
      )}

      {/* Open Marketplace Section */}
      <Collapsible open={openSectionExpanded} onOpenChange={setOpenSectionExpanded}>
        <Card className="border-blue-200 bg-gradient-to-br from-blue-50 via-sky-50 to-transparent dark:border-blue-800 dark:from-blue-950/20 dark:via-sky-950/20">
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-blue-100/50 dark:hover:bg-blue-900/20 transition-colors rounded-t-lg">
              <div className="flex items-center gap-3">
                <ShoppingBag className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-xl text-blue-900 dark:text-blue-100">
                      Open in Marketplace
                    </CardTitle>
                    {hasOpenTrades && (
                      <Badge variant="outline" className="border-blue-300 text-blue-700 dark:border-blue-600 dark:text-blue-300">
                        {openTrades.length}
                      </Badge>
                    )}
                  </div>
                  <CardDescription className="text-blue-700 dark:text-blue-300">
                    Shifts posted for trade, awaiting another employee to accept
                  </CardDescription>
                </div>
                <ChevronDown className={`h-5 w-5 text-blue-600 dark:text-blue-400 transition-transform ${openSectionExpanded ? 'rotate-180' : ''}`} />
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0">
              {hasOpenTrades ? (
                <div className="space-y-3">
                  {/* Expired open trades (removable) */}
                  {hasExpiredOpen && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                          Expired
                        </p>
                        {/* Bulk remove button — disabled when any delete is in-flight */}
                        {hasAnyStale && (
                          <Button
                            ref={bulkRemoveBtnRef}
                            size="sm"
                            variant="outline"
                            className="h-7 text-[12px] border-destructive/40 text-destructive hover:bg-destructive/10"
                            disabled={deletingIds.size > 0}
                            onClick={handleRemoveBulk}
                          >
                            Remove all expired ({allStaleIds.length})
                          </Button>
                        )}
                      </div>
                      {expiredOpen.map((trade) => (
                        <OpenTradeCard
                          key={trade.id}
                          trade={trade}
                          expired
                          isRemoving={deletingIds.has(trade.id)}
                          onRemove={() => handleRemoveSingle(trade)}
                        />
                      ))}
                    </div>
                  )}

                  {/* Active (non-expired) open trades — read-only */}
                  {hasActiveOpen && (
                    <div className="space-y-2">
                      {hasExpiredOpen && (
                        <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                          Active
                        </p>
                      )}
                      {activeOpen.map((trade) => (
                        <OpenTradeCard key={trade.id} trade={trade} />
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-6 text-center">
                  <ShoppingBag className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No shifts currently in the marketplace.</p>
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Bulk "Remove all expired" button — also shown outside marketplace section when
          only stale pending trades exist (no open trades) */}
      {!hasOpenTrades && hasAnyStale && (
        <div className="flex justify-end">
          <Button
            ref={!hasExpiredOpen ? bulkRemoveBtnRef : undefined}
            size="sm"
            variant="outline"
            className="h-7 text-[12px] border-destructive/40 text-destructive hover:bg-destructive/10"
            disabled={deletingIds.size > 0}
            onClick={handleRemoveBulk}
          >
            Remove all expired ({allStaleIds.length})
          </Button>
        </div>
      )}

      {/* Single-dialog for cleanup confirm (single or bulk) */}
      <Dialog open={confirmTarget !== null} onOpenChange={(open) => !open && handleCancelRemove()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" />
              {confirmTarget?.type === 'bulk'
                ? `Remove ${confirmTarget.ids.length} stale trade${confirmTarget.ids.length === 1 ? '' : 's'}?`
                : 'Remove stale trade?'}
            </DialogTitle>
            <DialogDescription>
              {confirmTarget?.type === 'bulk'
                ? `This will permanently remove ${confirmTarget.ids.length} trade${confirmTarget.ids.length === 1 ? '' : 's'} (${confirmTarget.ids.length} trade${confirmTarget.ids.length === 1 ? '' : 's'}). This action cannot be undone.`
                : 'This will permanently remove the stale trade request. This action cannot be undone.'}
            </DialogDescription>
          </DialogHeader>

          {confirmTarget?.type === 'single' && (
            <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm space-y-1">
              <p>
                <span className="font-medium">Posted by:</span>{' '}
                {confirmTarget.trade.offered_by?.name ?? 'Unknown'}
              </p>
              {confirmTarget.trade.offered_shift && (
                <p>
                  <span className="font-medium">Shift date:</span>{' '}
                  {format(new Date(confirmTarget.trade.offered_shift.start_time), 'EEEE, MMMM d, yyyy')}
                </p>
              )}
              <p>
                <span className="font-medium">Status:</span> {confirmTarget.trade.status}
              </p>
            </div>
          )}

          {confirmTarget?.type === 'bulk' && (
            <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm">
              <p className="text-muted-foreground">
                {confirmTarget.ids.length} trade{confirmTarget.ids.length === 1 ? '' : 's'} will be removed.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={handleCancelRemove}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmRemove}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Claim Approval/Rejection Dialog */}
      <Dialog open={!!selectedClaim && !!claimActionType} onOpenChange={(open) => !open && handleClaimCancel()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {claimActionType === 'approve' ? (
                <>
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  Approve Shift Claim
                </>
              ) : (
                <>
                  <XCircle className="h-5 w-5 text-red-600" />
                  Reject Shift Claim
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              {claimActionType === 'approve'
                ? 'This will assign the shift to the claiming employee.'
                : 'This will decline the claim request.'}
            </DialogDescription>
          </DialogHeader>

          {selectedClaim && (
            <div className="space-y-4">
              {/* Claim Summary */}
              <div className="rounded-lg border border-border bg-muted/20 p-4">
                <h4 className="mb-3 text-sm font-semibold text-muted-foreground">Claim Summary</h4>
                <div className="space-y-1 text-sm">
                  <p>
                    <span className="font-medium">Employee:</span>{' '}
                    {selectedClaim.employee?.name ?? 'Unknown'}
                  </p>
                  <p>
                    <span className="font-medium">Shift:</span>{' '}
                    {selectedClaim.shift_template?.name ?? 'Unknown'}
                  </p>
                  <p>
                    <span className="font-medium">Date:</span>{' '}
                    {format(parseDateLocal(selectedClaim.shift_date), 'EEEE, MMMM d, yyyy')}
                  </p>
                  {selectedClaim.shift_template && (
                    <p>
                      <span className="font-medium">Time:</span>{' '}
                      {selectedClaim.shift_template.start_time} – {selectedClaim.shift_template.end_time}
                    </p>
                  )}
                  <p>
                    <span className="font-medium">Position:</span>{' '}
                    {selectedClaim.shift_template?.position ?? selectedClaim.employee?.position ?? '—'}
                  </p>
                </div>
              </div>

              {/* Manager Note */}
              <div className="space-y-2">
                <Label htmlFor="claim-manager-note" className="text-sm font-medium">
                  Add Note{' '}
                  <span className="text-muted-foreground">
                    ({claimActionType === 'reject' ? 'Recommended' : 'Optional'})
                  </span>
                </Label>
                <Textarea
                  id="claim-manager-note"
                  placeholder={
                    claimActionType === 'approve'
                      ? 'Optional note about this approval...'
                      : 'Explain why this claim is being rejected...'
                  }
                  value={claimNote}
                  onChange={(e) => setClaimNote(e.target.value)}
                  rows={3}
                  className="resize-none"
                />
              </div>

              {claimActionType === 'approve' && (
                <div className="flex items-start gap-2 rounded-lg bg-green-50 p-3 dark:bg-green-950/20">
                  <AlertCircle className="mt-0.5 h-4 w-4 text-green-600 dark:text-green-400" />
                  <p className="text-xs text-green-700 dark:text-green-300">
                    The employee will be notified of your decision.
                  </p>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={handleClaimCancel} disabled={isApprovingClaim || isRejectingClaim}>
              Cancel
            </Button>
            <Button
              onClick={handleClaimConfirm}
              disabled={isApprovingClaim || isRejectingClaim}
              variant={claimActionType === 'approve' ? 'default' : 'destructive'}
            >
              {renderClaimButtonContent(claimActionType, isApprovingClaim || isRejectingClaim)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Trade Approval/Rejection Dialog */}
      <Dialog open={!!selectedTrade && !!actionType} onOpenChange={(open) => !open && handleCancel()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {actionType === 'approve' ? (
                <>
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  Approve Trade Request
                </>
              ) : (
                <>
                  <XCircle className="h-5 w-5 text-red-600" />
                  Reject Trade Request
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              {actionType === 'approve'
                ? 'This will transfer the shift to the accepting employee.'
                : 'This will decline the trade request and keep the original assignment.'}
            </DialogDescription>
          </DialogHeader>

          {selectedTrade && (
            <div className="space-y-4">
              {/* Trade Summary */}
              <div className="rounded-lg border border-border bg-muted/20 p-4">
                <h4 className="mb-3 text-sm font-semibold text-muted-foreground">Trade Summary</h4>
                <div className="flex items-center gap-2">
                  <div className="flex-1 text-center">
                    <p className="text-xs text-muted-foreground">From</p>
                    <p className="font-medium">{selectedTrade.offered_by?.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {selectedTrade.offered_by?.position}
                    </p>
                  </div>
                  <ArrowRight className="h-5 w-5 text-muted-foreground" />
                  <div className="flex-1 text-center">
                    <p className="text-xs text-muted-foreground">To</p>
                    <p className="font-medium">{selectedTrade.accepted_by?.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {selectedTrade.accepted_by?.position}
                    </p>
                  </div>
                </div>
                <div className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
                  <p>
                    <span className="font-medium">Date:</span>{' '}
                    {selectedTrade.offered_shift &&
                      format(new Date(selectedTrade.offered_shift.start_time), 'EEEE, MMMM d')}
                  </p>
                  <p>
                    <span className="font-medium">Time:</span>{' '}
                    {selectedTrade.offered_shift &&
                      `${format(new Date(selectedTrade.offered_shift.start_time), 'h:mm a')} - ${format(new Date(selectedTrade.offered_shift.end_time), 'h:mm a')}`}
                  </p>
                  <p>
                    <span className="font-medium">Position:</span>{' '}
                    {selectedTrade.offered_shift?.position}
                  </p>
                </div>
              </div>

              {/* Employee Reason */}
              {selectedTrade.reason && (
                <div className="rounded-lg bg-blue-50 p-4 dark:bg-blue-950/20">
                  <p className="mb-1 text-sm font-medium text-blue-900 dark:text-blue-100">
                    Employee Reason:
                  </p>
                  <p className="text-sm text-blue-700 dark:text-blue-300">
                    {selectedTrade.reason}
                  </p>
                </div>
              )}

              {/* Manager Note */}
              <div className="space-y-2">
                <Label htmlFor="manager-note" className="text-sm font-medium">
                  Add Note{' '}
                  <span className="text-muted-foreground">
                    ({actionType === 'reject' ? 'Recommended' : 'Optional'})
                  </span>
                </Label>
                <Textarea
                  id="manager-note"
                  placeholder={
                    actionType === 'approve'
                      ? 'Optional note about this approval...'
                      : 'Explain why this trade is being rejected...'
                  }
                  value={managerNote}
                  onChange={(e) => setManagerNote(e.target.value)}
                  rows={3}
                  className="resize-none"
                />
              </div>

              {actionType === 'approve' && (
                <div className="flex items-start gap-2 rounded-lg bg-green-50 p-3 dark:bg-green-950/20">
                  <AlertCircle className="mt-0.5 h-4 w-4 text-green-600 dark:text-green-400" />
                  <p className="text-xs text-green-700 dark:text-green-300">
                    Both employees will be notified via email of your decision.
                  </p>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={handleCancel} disabled={isApproving || isRejecting}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={isApproving || isRejecting}
              variant={actionType === 'approve' ? 'default' : 'destructive'}
            >
              {(() => {
                if (isApproving || isRejecting) {
                  return (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Processing...
                    </>
                  );
                }
                if (actionType === 'approve') {
                  return (
                    <>
                      <CheckCircle className="mr-2 h-4 w-4" />
                      Approve
                    </>
                  );
                }
                return (
                  <>
                    <XCircle className="mr-2 h-4 w-4" />
                    Reject
                  </>
                );
              })()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// Individual Trade Request Card
interface TradeRequestCardProps {
  trade: ShiftTrade;
  onApprove: () => void;
  onReject: () => void;
  disabled: boolean;
}

const TradeRequestCard = ({ trade, onApprove, onReject, disabled }: TradeRequestCardProps) => {
  if (!trade.offered_shift || !trade.offered_by || !trade.accepted_by) {
    return null;
  }

  const shiftStart = new Date(trade.offered_shift.start_time);
  const shiftEnd = new Date(trade.offered_shift.end_time);

  return (
    <Card data-testid="pending-trade" className="border-amber-200 dark:border-amber-800">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg">{trade.offered_shift.position}</CardTitle>
            <CardDescription className="mt-1">
              {format(shiftStart, 'EEEE, MMMM d, yyyy')}
            </CardDescription>
          </div>
          <Badge className="bg-amber-500">Pending</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Time */}
        <div className="flex items-center gap-2 text-sm">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span>
            {format(shiftStart, 'h:mm a')} - {format(shiftEnd, 'h:mm a')}
          </span>
        </div>

        {/* Trade Flow */}
        <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-3">
          <div className="flex-1 text-center">
            <p className="text-xs text-muted-foreground">From</p>
            <p className="font-medium">{trade.offered_by?.name ?? 'Unknown'}</p>
            <p className="text-xs text-muted-foreground">{trade.offered_by?.position ?? ''}</p>
          </div>
          <ArrowRight className="h-5 w-5 text-muted-foreground" />
          <div className="flex-1 text-center">
            <p className="text-xs text-muted-foreground">To</p>
            <p className="font-medium">{trade.accepted_by.name}</p>
            <p className="text-xs text-muted-foreground">{trade.accepted_by.position}</p>
          </div>
        </div>

        {/* Reason */}
        {trade.reason && (
          <div className="flex items-start gap-2 rounded-md bg-blue-50 p-3 dark:bg-blue-950/20">
            <FileText className="mt-0.5 h-4 w-4 text-blue-600 dark:text-blue-400" />
            <div className="flex-1">
              <p className="text-xs font-medium text-blue-900 dark:text-blue-100">Reason:</p>
              <p className="mt-1 text-sm text-blue-700 dark:text-blue-300">{trade.reason}</p>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button
            onClick={onReject}
            disabled={disabled}
            variant="outline"
            className="flex-1 border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/20"
          >
            <XCircle className="mr-2 h-4 w-4" />
            Reject
          </Button>
          <Button onClick={onApprove} disabled={disabled} className="flex-1">
            <CheckCircle className="mr-2 h-4 w-4" />
            Approve
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

// Claim Request Card
interface ClaimRequestCardProps {
  claim: OpenShiftClaimWithJoins;
  onApprove: () => void;
  onReject: () => void;
  disabled: boolean;
}

const ClaimRequestCard = ({ claim, onApprove, onReject, disabled }: ClaimRequestCardProps) => {
  const shiftDate = parseDateLocal(claim.shift_date);

  return (
    <Card data-testid="pending-claim" className="border-green-200 dark:border-green-800">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg">
              {claim.shift_template?.position ?? '—'}
            </CardTitle>
            <CardDescription className="mt-1">
              {format(shiftDate, 'EEEE, MMMM d, yyyy')}
            </CardDescription>
          </div>
          <Badge className="bg-green-500">Claim</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Time */}
        {claim.shift_template && (
          <div className="flex items-center gap-2 text-sm">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span>
              {claim.shift_template.start_time} – {claim.shift_template.end_time}
            </span>
          </div>
        )}

        {/* Employee info */}
        <div className="rounded-lg bg-muted/50 p-3 text-sm">
          <p className="text-xs text-muted-foreground mb-1">Requesting employee</p>
          <p className="font-medium">{claim.employee?.name ?? 'Unknown'}</p>
          {claim.employee?.position && (
            <p className="text-xs text-muted-foreground">{claim.employee.position}</p>
          )}
        </div>

        {/* Shift name */}
        {claim.shift_template?.name && (
          <div className="flex items-start gap-2 rounded-md bg-green-50 p-3 dark:bg-green-950/20">
            <FileText className="mt-0.5 h-4 w-4 text-green-600 dark:text-green-400" />
            <div className="flex-1">
              <p className="text-xs font-medium text-green-900 dark:text-green-100">Shift Template:</p>
              <p className="mt-1 text-sm text-green-700 dark:text-green-300">{claim.shift_template.name}</p>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button
            onClick={onReject}
            disabled={disabled}
            variant="outline"
            className="flex-1 border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/20"
          >
            <XCircle className="mr-2 h-4 w-4" />
            Reject
          </Button>
          <Button onClick={onApprove} disabled={disabled} className="flex-1 bg-green-600 hover:bg-green-700">
            <CheckCircle className="mr-2 h-4 w-4" />
            Approve
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

// Open Trade Card
interface OpenTradeCardProps {
  trade: ShiftTrade;
  /** Whether this trade's shift has already started (past). Default: false. */
  expired?: boolean;
  /** Whether a delete is currently in-flight for this specific trade. */
  isRemoving?: boolean;
  /** Called when the manager clicks the Remove button (only rendered when expired=true). */
  onRemove?: () => void;
}

const OpenTradeCard = ({ trade, expired = false, isRemoving = false, onRemove }: OpenTradeCardProps) => {
  if (!trade.offered_shift || !trade.offered_by) {
    return null;
  }

  const shiftStart = new Date(trade.offered_shift.start_time);
  const shiftEnd = new Date(trade.offered_shift.end_time);
  const postedAt = new Date(trade.created_at);

  return (
    <div className={`flex items-center justify-between rounded-lg border p-4 ${
      expired
        ? 'border-border/40 bg-muted/20'
        : 'border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/30'
    }`}>
      <div className="flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{trade.offered_by?.name ?? 'Unknown'}</span>
          <span className="text-muted-foreground">•</span>
          <span className="text-sm text-muted-foreground">{trade.offered_by?.position ?? ''}</span>
          {expired && (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              Expired
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>{format(shiftStart, 'EEE, MMM d')}</span>
          <span>
            {format(shiftStart, 'h:mm a')} - {format(shiftEnd, 'h:mm a')}
          </span>
          <Badge variant="outline" className="text-xs">
            {trade.offered_shift.position}
          </Badge>
        </div>
        {trade.reason && (
          <p className="text-xs text-muted-foreground italic">"{trade.reason}"</p>
        )}
      </div>
      <div className="flex flex-col items-end gap-2">
        {expired ? (
          <Button
            size="sm"
            variant="destructive"
            className="h-7 text-[12px]"
            disabled={isRemoving}
            onClick={onRemove}
          >
            {isRemoving ? (
              <>
                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                Removing…
              </>
            ) : (
              'Remove'
            )}
          </Button>
        ) : (
          <Badge variant="outline" className="border-blue-300 text-blue-700 dark:border-blue-600 dark:text-blue-300">
            Open
          </Badge>
        )}
        <p className="text-xs text-muted-foreground">
          Posted {format(postedAt, 'MMM d')}
        </p>
      </div>
    </div>
  );
};

// Stale Pending Row (ghost or expired pending_approval trade)
interface StalePendingRowProps {
  trade: ShiftTrade;
  isRemoving: boolean;
  onRemove: () => void;
}

const StalePendingRow = ({ trade, isRemoving, onRemove }: StalePendingRowProps) => {
  if (!trade.offered_shift) return null;

  const shiftStart = new Date(trade.offered_shift.start_time);
  const isGhost = !trade.accepted_by;

  return (
    <div className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/20 p-3">
      <div className="flex-1 space-y-0.5">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">{trade.offered_by?.name ?? 'Unknown'}</span>
          <span className="text-muted-foreground">•</span>
          <span className="text-muted-foreground">{trade.offered_shift.position}</span>
          <Badge variant="outline" className="text-xs text-muted-foreground">
            {isGhost ? 'Ghost' : 'Expired'}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {format(shiftStart, 'EEE, MMM d, yyyy')}
          {isGhost && ' — accepter no longer exists'}
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-[12px] border-destructive/40 text-destructive hover:bg-destructive/10"
        disabled={isRemoving}
        onClick={onRemove}
      >
        {isRemoving ? (
          <>
            <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
            Removing…
          </>
        ) : (
          'Remove'
        )}
      </Button>
    </div>
  );
};
