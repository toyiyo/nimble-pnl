import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePendingOutflowMutations } from "@/hooks/usePendingOutflows";
import { usePendingOutflowMatches } from "@/hooks/usePendingOutflows";
import { MatchSuggestionCard } from "./MatchSuggestionCard";
import type { PendingOutflow } from "@/types/pending-outflows";
import { formatCurrency } from "@/utils/pdfExport";
import { format } from "date-fns";
import { CheckCircle2, XCircle, FileText, Calendar, Hash, Trash2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface PendingOutflowCardProps {
  outflow: PendingOutflow;
}

export function PendingOutflowCard({ outflow }: PendingOutflowCardProps) {
  const [showVoidDialog, setShowVoidDialog] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [showMatches, setShowMatches] = useState(false);
  
  const { voidPendingOutflow, deletePendingOutflow } = usePendingOutflowMutations();
  const { data: matches } = usePendingOutflowMatches(outflow.id);

  const statusConfig = {
    pending: { 
      label: 'Pending', 
      className: 'bg-gradient-to-r from-yellow-500 to-orange-600',
      icon: Calendar
    },
    stale_30: { 
      label: 'Stale (30+ days)', 
      className: 'bg-gradient-to-r from-orange-500 to-red-600',
      icon: Calendar
    },
    stale_60: { 
      label: 'Stale (60+ days)', 
      className: 'bg-gradient-to-r from-red-500 to-red-700',
      icon: Calendar
    },
    stale_90: { 
      label: 'Stale (90+ days)', 
      className: 'bg-gradient-to-r from-red-600 to-red-900',
      icon: Calendar
    },
    cleared: { 
      label: 'Cleared', 
      className: 'bg-gradient-to-r from-green-500 to-emerald-600',
      icon: CheckCircle2
    },
    voided: { 
      label: 'Voided', 
      className: 'bg-gradient-to-r from-gray-500 to-gray-600',
      icon: XCircle
    },
  };

  const config = statusConfig[outflow.status];
  const Icon = config.icon;
  
  const paymentMethodLabels = {
    check: 'Check',
    ach: 'ACH',
    other: 'Other',
  };

  const handleVoid = () => {
    voidPendingOutflow.mutate(
      { id: outflow.id, reason: voidReason },
      { onSuccess: () => setShowVoidDialog(false) }
    );
  };

  const handleDelete = () => {
    if (confirm('Are you sure you want to delete this pending outflow? This action cannot be undone.')) {
      deletePendingOutflow.mutate(outflow.id);
    }
  };

  const hasHighScoreMatch = matches && matches.length > 0 && matches[0].match_score >= 85;

  return (
    <>
      <Card className={cn(
        "transition-all hover:shadow-md",
        outflow.status === 'cleared' && "opacity-60",
        hasHighScoreMatch && "border-green-500/50 bg-green-50/5"
      )}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <h3 className="font-semibold text-lg truncate">{outflow.vendor_name}</h3>
                <Badge className={config.className}>
                  <Icon className="w-3 h-3 mr-1" />
                  {config.label}
                </Badge>
                {hasHighScoreMatch && (
                  <Badge className="bg-gradient-to-r from-green-500 to-emerald-600">
                    <Sparkles className="w-3 h-3 mr-1" />
                    Match Found
                  </Badge>
                )}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <FileText className="w-3 h-3" />
                  <span>{paymentMethodLabels[outflow.payment_method]}</span>
                </div>
                
                <div className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  <span>{format(new Date(outflow.issue_date), 'MMM d, yyyy')}</span>
                </div>

                {outflow.reference_number && (
                  <div className="flex items-center gap-1">
                    <Hash className="w-3 h-3" />
                    <span>{outflow.reference_number}</span>
                  </div>
                )}

                {outflow.chart_account && (
                  <div className="truncate" title={outflow.chart_account.account_name}>
                    {outflow.chart_account.account_name}
                  </div>
                )}
              </div>

              {outflow.notes && (
                <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                  {outflow.notes}
                </p>
              )}

              {outflow.voided_reason && (
                <p className="text-sm text-destructive mt-2">
                  Void reason: {outflow.voided_reason}
                </p>
              )}
            </div>

            <div className="flex flex-col items-end gap-2">
              <span className="text-xl font-bold text-destructive">
                {formatCurrency(outflow.amount)}
              </span>

              {outflow.status === 'pending' || outflow.status.startsWith('stale_') ? (
                <div className="flex gap-1">
                  {matches && matches.length > 0 && (
                    <Button
                      size="sm"
                      variant={hasHighScoreMatch ? "default" : "outline"}
                      onClick={() => setShowMatches(!showMatches)}
                    >
                      <Sparkles className="w-3 h-3 mr-1" />
                      {hasHighScoreMatch ? 'Confirm Match' : `${matches.length} Match${matches.length > 1 ? 'es' : ''}`}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowVoidDialog(true)}
                  >
                    <XCircle className="w-3 h-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleDelete}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              ) : outflow.status === 'cleared' && outflow.cleared_at ? (
                <span className="text-xs text-muted-foreground">
                  Cleared {format(new Date(outflow.cleared_at), 'MMM d')}
                </span>
              ) : null}
            </div>
          </div>

          {showMatches && matches && matches.length > 0 && (
            <div className="mt-4 pt-4 border-t space-y-2">
              <h4 className="text-sm font-semibold">Suggested Matches</h4>
              {matches.slice(0, 3).map((match) => (
                <MatchSuggestionCard
                  key={match.bank_transaction_id}
                  match={match}
                  pendingOutflow={outflow}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={showVoidDialog} onOpenChange={setShowVoidDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void Pending Payment</AlertDialogTitle>
            <AlertDialogDescription>
              Mark this payment as voided (e.g., check was cancelled or lost).
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <Label htmlFor="void_reason">Reason for voiding</Label>
            <Input
              id="void_reason"
              placeholder="e.g., Check cancelled, reissued under new number"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setVoidReason('')}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleVoid}
              disabled={!voidReason.trim()}
            >
              Void Payment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
