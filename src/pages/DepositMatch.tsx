import { useMemo, useState } from 'react';
import { Landmark, Plus, ShieldAlert } from 'lucide-react';

import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useRestaurantClock } from '@/hooks/useRestaurantClock';
import { usePermissions } from '@/hooks/usePermissions';
import { useDepositMatch, useDepositMatchRule } from '@/hooks/useDepositMatch';
import { addDaysToDateStr } from '@/lib/restaurantClock';
import type { DepositMatchLedgerRow } from '@/types/depositMatch';

import { VerdictBanner } from '@/components/deposit-match/VerdictBanner';
import { MoneyWaterfall } from '@/components/deposit-match/MoneyWaterfall';
import { AttentionQueue } from '@/components/deposit-match/AttentionQueue';
import { StreamCards } from '@/components/deposit-match/StreamCards';
import { DailyLedger } from '@/components/deposit-match/DailyLedger';
import { ReviewDayDialog } from '@/components/deposit-match/ReviewDayDialog';
import { DisputeDialog } from '@/components/deposit-match/DisputeDialog';
import { SetupDialog } from '@/components/deposit-match/SetupDialog';

const REQUIRED_CAPABILITIES = ['view:banking', 'view:pos_sales'] as const;
const RANGE_OPTIONS = [7, 30, 90] as const;

export default function DepositMatch() {
  const { selectedRestaurant, loading: restaurantLoading } = useRestaurantContext();
  const { hasAllCapabilities, isResolved } = usePermissions();
  const restaurantId = selectedRestaurant?.restaurant_id ?? null;
  // The restaurant's own calendar day, not the viewer's browser clock — a
  // viewer west of the restaurant (or past midnight UTC) must see the same
  // "last 30 days" window the restaurant's owner sees.
  const { today } = useRestaurantClock();

  const [rangeDays, setRangeDays] = useState<(typeof RANGE_OPTIONS)[number]>(30);
  const [pageTab, setPageTab] = useState<'overview' | 'ledger'>('overview');
  const [activeItem, setActiveItem] = useState<DepositMatchLedgerRow | null>(null);
  const [dialogMode, setDialogMode] = useState<'review' | 'dispute' | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  // Null means "add a new rule"; a rule_id means "edit this rule".
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);

  const startDate = useMemo(() => addDaysToDateStr(today, -rangeDays), [today, rangeDays]);
  const endDate = today;

  const { report, isLoading, error, refreshNow } = useDepositMatch({ restaurantId, startDate, endDate });
  const { data: editingRule, isLoading: editingRuleLoading } = useDepositMatchRule(
    setupOpen ? editingRuleId : null
  );

  const openAddRule = () => {
    setEditingRuleId(null);
    setSetupOpen(true);
  };

  const openEditRule = (ruleId: string) => {
    setEditingRuleId(ruleId);
    setSetupOpen(true);
  };

  const openReview = (item: DepositMatchLedgerRow) => {
    setActiveItem(item);
    setDialogMode('review');
  };

  const openDispute = (item: DepositMatchLedgerRow) => {
    setActiveItem(item);
    setDialogMode('dispute');
  };

  const closeDialogs = (open: boolean) => {
    if (!open) setDialogMode(null);
  };

  const hasAccess = isResolved && hasAllCapabilities([...REQUIRED_CAPABILITIES]);

  if (!isResolved || restaurantLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-border/40 bg-muted/30 p-8 text-center max-w-md mx-auto">
          <ShieldAlert className="h-6 w-6 text-muted-foreground mx-auto mb-2" aria-hidden="true" />
          <p className="text-[14px] font-medium text-foreground">You cannot open Deposit Match.</p>
          <p className="text-[13px] text-muted-foreground mt-1">
            This page needs access to banking and POS sales.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        icon={Landmark}
        iconVariant="blue"
        title="Deposit Match"
        restaurantName={selectedRestaurant?.restaurant?.name}
        subtitle="Check that your card money reached the bank."
        actions={
          <Button
            className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
            onClick={openAddRule}
          >
            <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
            Add rule
          </Button>
        }
      />

      <div className="flex items-center gap-1">
        {RANGE_OPTIONS.map((days) => (
          <button
            key={days}
            type="button"
            onClick={() => setRangeDays(days)}
            aria-pressed={rangeDays === days}
            className={`h-8 px-3 rounded-lg text-[13px] font-medium transition-colors ${
              rangeDays === days
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {days} days
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      )}

      {!isLoading && error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
          <p className="text-[14px] font-medium text-destructive">Deposit Match could not load.</p>
          <p className="text-[13px] text-muted-foreground mt-1">{error.message}</p>
        </div>
      )}

      {!isLoading && !error && report && report.streams.length === 0 && (
        <div className="rounded-xl border border-border/40 bg-muted/30 p-8 text-center">
          <p className="text-[14px] font-medium text-foreground">No deposit-match rule is set up yet.</p>
          <p className="text-[13px] text-muted-foreground mt-1">
            Add a rule to start checking a POS source against your bank.
          </p>
          <Button
            className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium mt-4"
            onClick={openAddRule}
          >
            Add rule
          </Button>
        </div>
      )}

      {!isLoading && !error && report && report.streams.length > 0 && (
        <div className="space-y-6">
          <div className="flex items-center gap-1 border-b border-border/40">
            {(['overview', 'ledger'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setPageTab(tab)}
                className={`relative px-0 py-3 mr-6 text-[14px] font-medium transition-colors ${
                  pageTab === tab ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab === 'overview' ? 'Overview' : 'Daily ledger'}
                {pageTab === tab && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground" />}
              </button>
            ))}
          </div>

          {pageTab === 'overview' && (
            <div className="space-y-4">
              <VerdictBanner report={report} />
              <MoneyWaterfall report={report} />
              <StreamCards
                streams={report.streams}
                activeStreamId={null}
                onSelectStream={() => setPageTab('ledger')}
                onEditStream={openEditRule}
              />
              <AttentionQueue report={report} onSelectItem={openReview} />
            </div>
          )}

          {pageTab === 'ledger' && <DailyLedger report={report} onSelectItem={openReview} />}
        </div>
      )}

      <ReviewDayDialog
        item={activeItem}
        open={dialogMode === 'review'}
        onOpenChange={closeDialogs}
        restaurantId={restaurantId}
        onDispute={openDispute}
      />
      <DisputeDialog
        item={activeItem}
        report={report}
        open={dialogMode === 'dispute'}
        onOpenChange={closeDialogs}
        restaurantId={restaurantId}
      />
      <SetupDialog
        open={setupOpen}
        onOpenChange={setSetupOpen}
        restaurantId={restaurantId}
        banks={report?.banks ?? []}
        rule={editingRuleId ? editingRule ?? null : null}
        isLoadingRule={editingRuleId !== null && editingRuleLoading}
        onSaved={refreshNow}
      />
    </div>
  );
}
