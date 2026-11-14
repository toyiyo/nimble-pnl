import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { PageHeader } from '@/components/PageHeader';
import { ReturningGuestsChart } from '@/components/returning-guests/ReturningGuestsChart';
import { ReturningGuestsSummary } from '@/components/returning-guests/ReturningGuestsSummary';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

import { Repeat } from 'lucide-react';

import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useReturningGuestTrends } from '@/hooks/useReturningGuestTrends';

import {
  ALLOWED_WEEKS,
  canViewReturningGuests,
  noteForQuality,
  parseCampaignStart,
  parseWeeks,
  warmupNote,
} from '@/lib/returningGuests';
import { safeTz, toBusinessDay } from '@/lib/restaurantClock';

const LABEL = 'text-[12px] font-medium text-muted-foreground uppercase tracking-wider';

export default function ReturningGuests() {
  const { selectedRestaurant, loading: restaurantLoading } = useRestaurantContext();
  const [searchParams, setSearchParams] = useSearchParams();

  const role = selectedRestaurant?.role;
  const allowed = canViewReturningGuests(role);
  const restaurantId = allowed ? (selectedRestaurant?.restaurant_id ?? null) : null;
  const today = toBusinessDay(new Date(), safeTz(selectedRestaurant?.restaurant?.timezone));
  const start = parseCampaignStart(searchParams.get('start'), today);
  const weeks = parseWeeks(searchParams.get('weeks'));

  const { data, isLoading, error, refetch } = useReturningGuestTrends(restaurantId, start, weeks);

  // The input keeps a draft. A partial date from the keyboard does not clear the URL.
  const [draftStart, setDraftStart] = useState(start ?? '');
  useEffect(() => {
    setDraftStart(start ?? '');
  }, [start]);

  const update = (patch: { start?: string; weeks?: number }) => {
    const next = new URLSearchParams(searchParams);
    if (patch.start !== undefined) {
      if (patch.start) next.set('start', patch.start);
      else next.delete('start');
    }
    if (patch.weeks !== undefined) next.set('weeks', String(patch.weeks));
    setSearchParams(next, { replace: true });
  };

  if (!selectedRestaurant) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        {restaurantLoading ? (
          <Skeleton data-testid="rg-skeleton" className="h-28 rounded-xl" />
        ) : (
          <p className="text-[14px] text-muted-foreground">Select a restaurant to see returning guests.</p>
        )}
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <p className="text-[14px] text-muted-foreground">Only owners and managers can see this page.</p>
      </div>
    );
  }

  const actions = (
    <div className="flex flex-col sm:flex-row gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="rg-start" className={LABEL}>Campaign start</Label>
        <Input
          id="rg-start"
          type="date"
          max={today}
          value={draftStart}
          onChange={(e) => {
            const value = e.target.value;
            setDraftStart(value);
            if (parseCampaignStart(value, today)) update({ start: value });
          }}
          onBlur={() => {
            if (draftStart === '') update({ start: '' });
            else if (!parseCampaignStart(draftStart, today)) setDraftStart(start ?? '');
          }}
          className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="rg-weeks" className={LABEL}>Weeks</Label>
        <Select value={String(weeks)} onValueChange={(v) => update({ weeks: Number(v) })}>
          <SelectTrigger id="rg-weeks" className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ALLOWED_WEEKS.map((w) => (
              <SelectItem key={w} value={String(w)}>{w} weeks</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );

  const hasWarmup = !!data?.weeks.some((w) => w.period === 'before' && w.warmup);
  const quality = data ? noteForQuality(data.match_quality) : null;
  const noteParts = [quality, hasWarmup && data?.history_start ? warmupNote(data.history_start) : null]
    .filter(Boolean)
    .join(' ');

  let body;
  if (!start) {
    body = (
      <p className="text-[14px] text-muted-foreground">
        Pick the date your campaign started. We compare the weeks before and after it.
      </p>
    );
  } else if (isLoading && !data) {
    body = (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} data-testid="rg-skeleton" className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton data-testid="rg-skeleton" className="h-56 rounded-xl" />
      </div>
    );
  } else if (error) {
    body = (
      <div className="space-y-3" role="alert">
        <p className="text-[14px] text-foreground">We could not load the returning guest data.</p>
        <Button
          onClick={() => void refetch()}
          className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
        >
          Retry
        </Button>
      </div>
    );
  } else if (data?.source === 'none') {
    body = (
      <p className="text-[14px] text-muted-foreground">
        Not available for your POS. We need card digits from Toast, Square, Revel or Focus.
      </p>
    );
  } else if (data) {
    body = (
      <div className="space-y-6">
        <ReturningGuestsSummary summary={data.summary} weeksCompared={data.weeks_compared} />
        <div className="rounded-xl border border-border/40 bg-background p-4">
          <ReturningGuestsChart weeks={data.weeks} campaignStart={start} />
        </div>
        {noteParts && (
          <p role="note" className="text-[13px] text-muted-foreground">{noteParts}</p>
        )}
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <PageHeader
        icon={Repeat}
        title="Returning Guests"
        restaurantName={selectedRestaurant?.restaurant?.name}
        actions={actions}
      />
      {body}
    </div>
  );
}
