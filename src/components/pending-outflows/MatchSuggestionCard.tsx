import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePendingOutflowMutations } from "@/hooks/usePendingOutflows";
import { useBankTransactions } from "@/hooks/useBankTransactions";
import type { PendingOutflowMatch, PendingOutflow } from "@/types/pending-outflows";
import { formatCurrency } from "@/utils/pdfExport";
import { format } from "date-fns";
import { CheckCircle2, Building2, Calendar, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface MatchSuggestionCardProps {
  match: PendingOutflowMatch;
  pendingOutflow: PendingOutflow;
}

export function MatchSuggestionCard({ match, pendingOutflow }: MatchSuggestionCardProps) {
  const { confirmMatch } = usePendingOutflowMutations();
  const { data: allTransactions } = useBankTransactions('for_review');

  const transaction = allTransactions?.find(t => t.id === match.bank_transaction_id);

  if (!transaction) return null;

  const handleConfirm = () => {
    confirmMatch.mutate({
      pendingOutflowId: pendingOutflow.id,
      bankTransactionId: match.bank_transaction_id,
    });
  };

  const scoreColor = 
    match.match_score >= 85 ? 'from-green-500 to-emerald-600' :
    match.match_score >= 70 ? 'from-yellow-500 to-orange-600' :
    'from-orange-500 to-red-600';

  return (
    <Card className={cn(
      "border transition-all",
      match.match_score >= 85 ? "border-green-500/50 bg-green-50/5" : "border-border"
    )}>
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center gap-2">
              <Badge className={`bg-gradient-to-r ${scoreColor}`}>
                {match.match_score}% Match
              </Badge>
              {match.match_score >= 85 && (
                <span className="text-xs text-green-600 font-medium">
                  High confidence
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex items-center gap-1 text-muted-foreground">
                <Building2 className="w-3 h-3" />
                <span className="truncate" title={match.payee_similarity}>
                  {match.payee_similarity}
                </span>
              </div>

              <div className="flex items-center gap-1 text-muted-foreground">
                <Calendar className="w-3 h-3" />
                <span>{format(new Date(transaction.transaction_date), 'MMM d, yyyy')}</span>
              </div>

              <div className="flex items-center gap-1">
                <TrendingDown className="w-3 h-3 text-destructive" />
                <span className="font-semibold">{formatCurrency(Math.abs(transaction.amount))}</span>
              </div>

              {Math.abs(match.amount_delta) > 0.01 && (
                <div className="text-xs text-muted-foreground">
                  Δ {formatCurrency(Math.abs(match.amount_delta))}
                </div>
              )}

              {match.date_delta !== 0 && (
                <div className="text-xs text-muted-foreground col-span-2">
                  {Math.abs(match.date_delta)} day{Math.abs(match.date_delta) !== 1 ? 's' : ''} {match.date_delta > 0 ? 'after' : 'before'} issue date
                </div>
              )}
            </div>

            {transaction.description && (
              <p className="text-xs text-muted-foreground line-clamp-1">
                {transaction.description}
              </p>
            )}
          </div>

          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={confirmMatch.isPending}
            className="shrink-0"
          >
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Confirm
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
