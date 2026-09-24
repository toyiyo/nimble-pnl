import { useEffect, useMemo, useState } from 'react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatCurrency } from '@/lib/utils';
import { formatBusinessDate, pickActiveTab } from '@/lib/depositMatchUi';
import type { DepositMatchLedgerRow, DepositMatchReport } from '@/types/depositMatch';
import { StatusChip } from './StatusChip';

interface DailyLedgerProps {
  report: DepositMatchReport;
  onSelectItem: (row: DepositMatchLedgerRow) => void;
}

/**
 * Per-day rows with status chips, one tab per stream. The tabs come from a
 * `.map()` over `report.streams` — `activeTab` holds a dynamic stream id
 * (string), not a literal union, because the set of streams is data. When a
 * refetch removes the active stream, the tab falls back to the first one.
 */
export function DailyLedger({ report, onSelectItem }: DailyLedgerProps) {
  const [activeTab, setActiveTab] = useState<string | null>(() =>
    pickActiveTab(report.streams, null)
  );

  useEffect(() => {
    setActiveTab((current) => pickActiveTab(report.streams, current));
  }, [report.streams]);

  // One grouping pass per `report.ledger` change, not a fresh filter+sort
  // of the whole ledger for every stream on every render.
  const rowsByStream = useMemo(() => {
    const map = new Map<string, DepositMatchLedgerRow[]>();
    for (const row of report.ledger) {
      const rows = map.get(row.rule_id);
      if (rows) {
        rows.push(row);
      } else {
        map.set(row.rule_id, [row]);
      }
    }
    for (const rows of map.values()) {
      rows.sort((a, b) => a.business_date.localeCompare(b.business_date));
    }
    return map;
  }, [report.ledger]);

  if (report.streams.length === 0 || !activeTab) {
    return (
      <div className="rounded-xl border border-border/40 bg-muted/30 p-6 text-center">
        <p className="text-[13px] text-muted-foreground">No deposit-match rule is set up yet.</p>
      </div>
    );
  }

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <TabsList className="bg-transparent p-0 h-auto border-b border-border/40 rounded-none w-full justify-start">
        {report.streams.map((stream) => (
          <TabsTrigger
            key={stream.rule_id}
            value={stream.rule_id}
            className="relative px-0 py-3 mr-6 text-[14px] font-medium data-[state=active]:shadow-none data-[state=active]:bg-transparent rounded-none"
          >
            {stream.pos_source}
          </TabsTrigger>
        ))}
      </TabsList>
      {report.streams.map((stream) => {
        const rows = rowsByStream.get(stream.rule_id) ?? [];

        return (
          <TabsContent key={stream.rule_id} value={stream.rule_id} className="mt-3">
            {rows.length === 0 ? (
              <div className="rounded-xl border border-border/40 bg-muted/30 p-6 text-center">
                <p className="text-[13px] text-muted-foreground">No days in this range yet.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-border/40 bg-background overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-border/40 bg-muted/50">
                      <th className="px-4 py-2 text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                        Date
                      </th>
                      <th className="px-4 py-2 text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                        Expected
                      </th>
                      <th className="px-4 py-2 text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                        Received
                      </th>
                      <th className="px-4 py-2 text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.item_id} className="border-b border-border/40 last:border-b-0">
                        <td className="px-4 py-2.5 text-[14px] text-foreground">{formatBusinessDate(row.business_date)}</td>
                        <td className="px-4 py-2.5 text-[14px] text-foreground">
                          {formatCurrency(row.expected_amount)}
                        </td>
                        <td className="px-4 py-2.5 text-[14px] text-foreground">
                          {formatCurrency(row.received_amount)}
                        </td>
                        <td className="px-4 py-2.5">
                          <button
                            type="button"
                            onClick={() => onSelectItem(row)}
                            className="inline-flex"
                            aria-label={`Review ${formatBusinessDate(row.business_date)} for ${stream.pos_source}`}
                          >
                            <StatusChip status={row.status} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
