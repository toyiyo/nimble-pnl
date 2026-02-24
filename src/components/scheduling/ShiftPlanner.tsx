import { useState, useCallback } from 'react';

import { CalendarDays } from 'lucide-react';

import { useGenerateSchedule } from '@/hooks/useScheduleSlots';

import { WeekTemplateBuilder } from './WeekTemplateBuilder';
import { ScheduleAssignment } from './ScheduleAssignment';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type View = 'template' | 'assignment';

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

  // Handle generate: call RPC, on success switch to assignment view
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
            setView('assignment');
          },
        },
      );
    },
    [restaurantId, generateMutation],
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
        />
      ) : (
        <ScheduleAssignment
          restaurantId={restaurantId}
          weekStartDate={targetWeekStart}
          onBack={handleBack}
        />
      )}
    </div>
  );
}
