import { useRef, useState, useCallback, useMemo, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { Inbox, AlertTriangle, Clock, X, Sparkles } from 'lucide-react';

import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useAiChatContext } from '@/contexts/AiChatContext';
import { useOpsInbox, useOpsInboxCount, OpsInboxItem } from '@/hooks/useOpsInbox';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 172800) return 'Yesterday';
  return `${Math.floor(seconds / 86400)}d ago`;
}

const KIND_LABELS: Record<OpsInboxItem['kind'], string> = {
  uncategorized_txn: 'Uncategorized Txn',
  uncategorized_pos: 'Uncategorized POS',
  anomaly: 'Anomaly',
  reconciliation: 'Reconciliation',
  recommendation: 'Recommendation',
};

function priorityBadgeClass(priority: number): string {
  if (priority === 1) return 'bg-destructive/10 text-destructive';
  if (priority === 2) return 'bg-orange-500/10 text-orange-600';
  if (priority === 3) return 'bg-amber-500/10 text-amber-600';
  return 'bg-muted text-muted-foreground';
}

function priorityLabel(priority: number): string {
  if (priority === 1) return 'Critical';
  if (priority === 2) return 'High';
  if (priority === 3) return 'Medium';
  if (priority === 4) return 'Low';
  return 'Info';
}

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

type TabKey = 'open' | 'critical' | 'snoozed' | 'resolved';

interface TabDef {
  key: TabKey;
  label: string;
}

const TABS: TabDef[] = [
  { key: 'open', label: 'All Open' },
  { key: 'critical', label: 'Critical' },
  { key: 'snoozed', label: 'Snoozed' },
  { key: 'resolved', label: 'Resolved' },
];

function tabToQueryOptions(tab: TabKey): { status?: string; priority?: number } {
  switch (tab) {
    case 'open':
      return { status: 'open' };
    case 'critical':
      return { status: 'open', priority: 1 };
    case 'snoozed':
      return { status: 'snoozed' };
    case 'resolved':
      return { status: 'all' };
    default:
      return { status: 'open' };
  }
}

// ---------------------------------------------------------------------------
// Pre-computed display values for memoized row
// ---------------------------------------------------------------------------

interface InboxItemDisplayValues {
  priorityClass: string;
  priorityText: string;
  kindLabel: string;
  relativeTime: string;
}

// ---------------------------------------------------------------------------
// Memoized row component - NO hooks allowed inside
// ---------------------------------------------------------------------------

interface InboxItemRowProps {
  item: OpsInboxItem;
  displayValues: InboxItemDisplayValues;
  onSnooze: (itemId: string, snoozedUntil: string) => void;
  onDismiss: (itemId: string) => void;
  onAskAi: () => void;
}

const InboxItemRow = memo(function InboxItemRow({
  item,
  displayValues,
  onSnooze,
  onDismiss,
  onAskAi,
}: InboxItemRowProps) {
  const { priorityClass, priorityText, kindLabel, relativeTime } = displayValues;

  return (
    <div className="group flex items-start gap-3 p-4 rounded-xl border border-border/40 bg-background hover:border-border transition-colors">
      {/* Priority badge */}
      <div className="flex flex-col items-center gap-1.5 pt-0.5 shrink-0">
        <span
          className={`text-[11px] px-1.5 py-0.5 rounded-md font-medium ${priorityClass}`}
        >
          {priorityText}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[14px] font-medium text-foreground truncate">
            {item.title}
          </span>
          <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground shrink-0">
            {kindLabel}
          </span>
        </div>
        {item.description && (
          <p className="text-[13px] text-muted-foreground line-clamp-2">
            {item.description}
          </p>
        )}
      </div>

      {/* Time + actions */}
      <div className="flex items-center gap-2 shrink-0 pt-0.5">
        <span className="text-[12px] text-muted-foreground whitespace-nowrap">
          {relativeTime}
        </span>

        {/* Hover-reveal actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* Snooze dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
                aria-label="Snooze item"
              >
                <Clock className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem
                onClick={() => {
                  const d = new Date();
                  d.setHours(d.getHours() + 1);
                  onSnooze(item.id, d.toISOString());
                }}
              >
                1 hour
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  const d = new Date();
                  d.setDate(d.getDate() + 1);
                  d.setHours(9, 0, 0, 0);
                  onSnooze(item.id, d.toISOString());
                }}
              >
                Tomorrow
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  const d = new Date();
                  d.setDate(d.getDate() + 7);
                  d.setHours(9, 0, 0, 0);
                  onSnooze(item.id, d.toISOString());
                }}
              >
                Next week
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Dismiss */}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
            aria-label="Dismiss item"
            onClick={() => onDismiss(item.id)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>

          {/* Ask AI */}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
            aria-label="Ask AI about this item"
            onClick={onAskAi}
          >
            <Sparkles className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}, (prev, next) => {
  return (
    prev.item.id === next.item.id &&
    prev.item.status === next.item.status &&
    prev.item.priority === next.item.priority &&
    prev.item.title === next.item.title &&
    prev.item.description === next.item.description &&
    prev.displayValues === next.displayValues &&
    prev.onSnooze === next.onSnooze &&
    prev.onDismiss === next.onDismiss &&
    prev.onAskAi === next.onAskAi
  );
});

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function InboxSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex items-start gap-3 p-4 rounded-xl border border-border/40"
        >
          <Skeleton className="h-5 w-14 rounded-md" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-3 w-12" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function InboxEmptyState({ tab }: { tab: TabKey }) {
  const messages: Record<TabKey, string> = {
    open: 'No open items. You are all caught up!',
    critical: 'No critical items right now.',
    snoozed: 'No snoozed items.',
    resolved: 'No resolved items yet.',
  };

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="h-12 w-12 rounded-xl bg-muted/50 flex items-center justify-center mb-4">
        <Inbox className="h-6 w-6 text-muted-foreground" />
      </div>
      <p className="text-[14px] text-muted-foreground">{messages[tab]}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export default function OpsInbox() {
  const { selectedRestaurant } = useRestaurantContext();
  const { openChat } = useAiChatContext();
  const restaurantId = selectedRestaurant?.restaurant_id;

  const [activeTab, setActiveTab] = useState<TabKey>('open');

  const queryOptions = tabToQueryOptions(activeTab);

  const { items: rawItems, isLoading, error, updateStatus } = useOpsInbox(restaurantId, {
    status: queryOptions.status,
    priority: queryOptions.priority,
  });

  const { data: counts } = useOpsInboxCount(restaurantId);

  // For the "resolved" tab we query status='all' and filter client-side
  const items = useMemo(() => {
    if (activeTab === 'resolved') {
      return rawItems.filter(
        (item) => item.status === 'done' || item.status === 'dismissed'
      );
    }
    return rawItems;
  }, [rawItems, activeTab]);

  // Pre-compute display values
  const displayValuesMap = useMemo(() => {
    const map = new Map<string, InboxItemDisplayValues>();
    for (const item of items) {
      map.set(item.id, {
        priorityClass: priorityBadgeClass(item.priority),
        priorityText: priorityLabel(item.priority),
        kindLabel: KIND_LABELS[item.kind] || item.kind,
        relativeTime: timeAgo(item.created_at),
      });
    }
    return map;
  }, [items]);

  // Virtualizer
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 88,
    overscan: 10,
  });

  // Stable callbacks
  const handleSnooze = useCallback(
    (itemId: string, snoozedUntil: string) => {
      updateStatus({ itemId, newStatus: 'snoozed', snoozedUntil });
    },
    [updateStatus]
  );

  const handleDismiss = useCallback(
    (itemId: string) => {
      updateStatus({ itemId, newStatus: 'dismissed' });
    },
    [updateStatus]
  );

  const handleAskAi = useCallback(() => {
    openChat();
  }, [openChat]);

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-5xl mx-auto px-4 py-6">
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="h-12 w-12 rounded-xl bg-destructive/10 flex items-center justify-center mb-4">
              <AlertTriangle className="h-6 w-6 text-destructive" />
            </div>
            <p className="text-[14px] font-medium text-foreground mb-1">
              Failed to load inbox
            </p>
            <p className="text-[13px] text-muted-foreground">
              {error instanceof Error ? error.message : 'An unexpected error occurred.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <h1 className="text-[17px] font-semibold text-foreground">Ops Inbox</h1>
          {counts && counts.open > 0 && (
            <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground font-medium">
              {counts.open}
            </span>
          )}
        </div>

        {/* Apple underline tabs */}
        <div className="flex border-b border-border/40 mb-6">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`relative px-0 py-3 mr-6 text-[14px] font-medium transition-colors ${
                activeTab === tab.key
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
              {tab.key === 'critical' && counts && counts.critical > 0 && (
                <span className="ml-1.5 text-[11px] px-1.5 py-0.5 rounded-md bg-destructive/10 text-destructive font-medium">
                  {counts.critical}
                </span>
              )}
              {activeTab === tab.key && (
                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground" />
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        {isLoading ? (
          <InboxSkeleton />
        ) : items.length === 0 ? (
          <InboxEmptyState tab={activeTab} />
        ) : (
          <div
            ref={parentRef}
            className="h-[calc(100vh-220px)] overflow-auto"
          >
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative',
              }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const item = items[virtualRow.index];
                if (!item) return null;

                const displayValues = displayValuesMap.get(item.id);
                if (!displayValues) return null;

                return (
                  <div
                    key={item.id}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <div className="pb-3">
                      <InboxItemRow
                        item={item}
                        displayValues={displayValues}
                        onSnooze={handleSnooze}
                        onDismiss={handleDismiss}
                        onAskAi={handleAskAi}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
