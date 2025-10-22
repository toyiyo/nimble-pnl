import { Badge } from "@/components/ui/badge";
import { ArrowLeftRight, Split, Building2, CheckCircle2 } from "lucide-react";

interface TransactionBadgesProps {
  isTransfer?: boolean;
  isSplit?: boolean;
  isReconciled?: boolean;
  supplierName?: string;
  className?: string;
}

export function TransactionBadges({
  isTransfer,
  isSplit,
  isReconciled,
  supplierName,
  className = ""
}: TransactionBadgesProps) {
  const hasBadges = isTransfer || isSplit || isReconciled || supplierName;
  
  if (!hasBadges) return null;

  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {isTransfer && (
        <Badge variant="secondary" className="w-fit">
          <ArrowLeftRight className="h-3 w-3 mr-1" />
          Transfer
        </Badge>
      )}
      {isSplit && (
        <Badge variant="secondary" className="w-fit bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-200">
          <Split className="h-3 w-3 mr-1" />
          Split
        </Badge>
      )}
      {supplierName && (
        <Badge variant="secondary" className="w-fit bg-primary/10 text-primary">
          <Building2 className="h-3 w-3 mr-1" />
          {supplierName}
        </Badge>
      )}
      {isReconciled && (
        <Badge variant="secondary" className="w-fit bg-success/10 text-success border-success/20">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Reconciled
        </Badge>
      )}
    </div>
  );
}
