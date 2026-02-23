/**
 * Pure helper functions for Sling API data parsing.
 * These mirror the logic in supabase/functions/_shared/slingApiClient.ts
 * but are importable in frontend/test code without Deno dependencies.
 */

export function formatSlingDateInterval(
  startDate: string,
  endDate: string
): string {
  return `${startDate}T00:00:00/${endDate}T23:59:59`;
}

export interface ParsedSlingShift {
  sling_shift_id: number;
  sling_user_id: number | null;
  shift_date: string;
  start_time: string;
  end_time: string;
  break_duration: number;
  position: string;
  location: string;
  status: string;
  raw_json: Record<string, unknown>;
}

export function parseSlingShiftEvents(
  events: Record<string, unknown>[]
): ParsedSlingShift[] {
  return events
    .filter((e) => e.type === 'shift')
    .map((event) => {
      const user = event.user as Record<string, unknown> | undefined;
      const position = event.position as Record<string, unknown> | undefined;
      const location = event.location as Record<string, unknown> | undefined;
      const dtstart = event.dtstart as string | undefined;

      return {
        sling_shift_id: event.id as number,
        sling_user_id: (user?.id as number) ?? null,
        shift_date: dtstart?.split('T')[0] ?? '',
        start_time: dtstart ?? '',
        end_time: (event.dtend as string) ?? '',
        break_duration: (event.breakDuration as number) ?? 0,
        position: (position?.name as string) ?? '',
        location: (location?.name as string) ?? '',
        status: (event.status as string) ?? 'published',
        raw_json: event,
      };
    });
}

export interface ParsedSlingTimesheetEntry {
  sling_timesheet_id: number;
  sling_shift_id: number | null;
  sling_user_id: number;
  punch_type: string;
  punch_time: string;
  raw_json: Record<string, unknown>;
}

const VALID_PUNCH_TYPES = ['clock_in', 'clock_out', 'break_start', 'break_end'];

export function parseSlingTimesheetEntries(
  entries: Record<string, unknown>[]
): ParsedSlingTimesheetEntry[] {
  const results: ParsedSlingTimesheetEntry[] = [];

  for (const entry of entries) {
    const user = entry.user as Record<string, unknown> | undefined;
    if (!entry.id || !user?.id) continue;

    const type = entry.type as string;
    if (!VALID_PUNCH_TYPES.includes(type)) continue;

    const event = entry.event as Record<string, unknown> | undefined;

    results.push({
      sling_timesheet_id: entry.id as number,
      sling_shift_id: (event?.id as number) ?? null,
      sling_user_id: user.id as number,
      punch_type: type,
      punch_time: entry.timestamp as string,
      raw_json: entry,
    });
  }

  return results;
}
