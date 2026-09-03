import { AlertTriangle, CheckCircle2 } from 'lucide-react';

import { buildVerdict } from '@/lib/depositMatchUi';
import type { DepositMatchReport } from '@/types/depositMatch';

interface VerdictBannerProps {
  report: DepositMatchReport;
}

/** One plain-language answer: the worst open exception, or an all-clear. */
export function VerdictBanner({ report }: VerdictBannerProps) {
  const verdict = buildVerdict(report);
  const isClear = verdict.tone === 'clear';

  return (
    <div
      className={`flex items-center gap-3 p-4 rounded-xl border ${
        isClear
          ? 'bg-emerald-500/10 border-emerald-500/20'
          : 'bg-amber-500/10 border-amber-500/20'
      }`}
      role="status"
    >
      <div
        className={`h-10 w-10 shrink-0 rounded-xl flex items-center justify-center ${
          isClear ? 'bg-emerald-500/15' : 'bg-amber-500/15'
        }`}
      >
        {isClear ? (
          <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden="true" />
        ) : (
          <AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden="true" />
        )}
      </div>
      <p className="text-[15px] font-medium text-foreground">{verdict.headline}</p>
    </div>
  );
}
