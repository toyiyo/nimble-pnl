import { QueryClient } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Shared helpers for scheduling hook mutations.
// These are NOT React hooks — just plain utility functions.
// ---------------------------------------------------------------------------

/**
 * Invalidate schedule-related queries after mutations that touch
 * schedule_slots, shifts, or schedule_publications.
 */
export function invalidateScheduleQueries(
  queryClient: QueryClient,
  restaurantId: string,
  weekStartDate?: string,
) {
  if (weekStartDate) {
    queryClient.invalidateQueries({ queryKey: ['schedule-slots', restaurantId, weekStartDate] });
    queryClient.invalidateQueries({ queryKey: ['schedule-publication-status', restaurantId, weekStartDate] });
  }
  queryClient.invalidateQueries({ queryKey: ['shifts'] });
}

/**
 * Invalidate week-template-related queries after mutations that touch
 * week_templates or week_template_slots.
 */
export function invalidateTemplateQueries(
  queryClient: QueryClient,
  restaurantId: string,
) {
  queryClient.invalidateQueries({ queryKey: ['week-templates', restaurantId] });
  queryClient.invalidateQueries({ queryKey: ['week-template-slots'] });
}

/** Minimal toast signature used by the scheduling hooks. */
type ToastFn = (opts: { title: string; description: string; variant?: string }) => void;

/**
 * Standard destructive-error toast used by mutation onError handlers.
 */
export function showErrorToast(
  toast: ToastFn,
  title: string,
  error: Error,
) {
  toast({
    title,
    description: error.message,
    variant: 'destructive',
  });
}
