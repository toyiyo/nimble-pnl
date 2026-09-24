import type { DepositMatchStatus } from '@/types/depositMatch';

const STATUS_LABEL: Record<DepositMatchStatus, string> = {
  matched: 'Matched',
  matched_net: 'Matched (net)',
  pending: 'Pending',
  late: 'Late',
  short: 'Short',
  over: 'Over',
  needs_review: 'Needs review',
  incomplete: 'Incomplete',
};

const STATUS_CLASS: Record<DepositMatchStatus, string> = {
  matched: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  matched_net: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  pending: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  late: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  short: 'bg-red-500/10 text-red-700 dark:text-red-400',
  over: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  needs_review: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  incomplete: 'bg-muted text-muted-foreground',
};

interface StatusChipProps {
  status: DepositMatchStatus;
}

/** A semantic-token status chip shared by the ledger, the queue, and the dialogs. */
export function StatusChip({ status }: StatusChipProps) {
  return (
    <span
      className={`inline-flex items-center text-[11px] font-medium px-1.5 py-0.5 rounded-md ${STATUS_CLASS[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
