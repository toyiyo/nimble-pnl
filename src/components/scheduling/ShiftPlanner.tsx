import { useState, useCallback, lazy, Suspense } from 'react';

import { CalendarDays } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';

import { useGenerateSchedule } from '@/hooks/useScheduleSlots';

import { WeekTemplateBuilder } from './WeekTemplateBuilder';

// Lazy-load ScheduleBoard so its dependency tree (ToastAction, etc.) is
// deferred until the user actually switches to the board view.
const ScheduleBoard = lazy(() =>
  import('./ScheduleBoard').then((m) => ({ default: m.ScheduleBoard })),
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type View = 'template' | 'board';

interface ShiftPlannerProps {
  restaurantId: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ShiftPlanner({ restaurantId }: ShiftPlannerProps) {
  const [view, setView] = useState<View>('template');
  const [targetWeekStart, setTargetWeekStart] = useState('');

  const generateMutation = useGenerateSchedule();

  // Handle generate: call RPC, on success switch to board view
  const handleGenerateSchedule = useCallback(
    (templateId: string, weekStartDate: string) => {
      if (!restaurantId) return;

      generateMutation.mutate(
        {
          restaurantId,
          weekTemplateId: templateId,
          weekStartDate,
        },
        {
          onSuccess: () => {
            setTargetWeekStart(weekStartDate);
            setView('board');
          },
        },
      );
    },
    [restaurantId, generateMutation],
  );

  // View existing schedule (go to board without regenerating)
  const handleViewSchedule = useCallback(
    (weekStartDate: string) => {
      setTargetWeekStart(weekStartDate);
      setView('board');
    },
    [],
  );

  // Back to template view
  const handleBack = useCallback(() => {
    setView('template');
  }, []);

  // Guard: no restaurant selected
  if (!restaurantId) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="h-12 w-12 rounded-xl bg-muted/50 flex items-center justify-center mb-3">
          <CalendarDays className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="text-[14px] font-medium text-foreground">Select a restaurant</p>
        <p className="text-[13px] text-muted-foreground mt-1">
          Choose a restaurant to start building shift schedules.
        </p>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div>
      {view === 'template' ? (
        <WeekTemplateBuilder
          restaurantId={restaurantId}
          onGenerateSchedule={handleGenerateSchedule}
          onViewSchedule={handleViewSchedule}
        />
      ) : (
        <Suspense
          fallback={
            <div className="space-y-4">
              <Skeleton className="h-10 w-full rounded-lg" />
              <div className="grid grid-cols-7 gap-2">
                {Array.from({ length: 7 }).map((_, i) => (
                  <Skeleton key={i} className="h-48 rounded-xl" />
                ))}
              </div>
            </div>
          }
        >
          <ScheduleBoard
            restaurantId={restaurantId}
            weekStartDate={targetWeekStart}
            onBack={handleBack}
          />
        </Suspense>
      )}
    </div>
  );
}
