export type RestaurantBusinessHours = {
  [dayOfWeek: number]:
    | { open: string; close: string; is_closed: boolean }
    | null;
};

export type ShiftTemplateForDefaults = {
  days: number[];
  start_time: string;
  end_time: string;
};

export type AvailabilityDefault = {
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_available: boolean;
};

const CLOSED_DEFAULT = {
  start_time: '09:00:00',
  end_time: '17:00:00',
  is_available: false,
} as const;

function normalizeTime(value: string): string {
  // Accept 'HH:MM' or 'HH:MM:SS' and always return 'HH:MM:SS'.
  return value.length === 5 ? `${value}:00` : value;
}

function minTime(a: string, b: string): string {
  return a < b ? a : b;
}

function maxTime(a: string, b: string): string {
  return a > b ? a : b;
}

export function deriveDefaultAvailability(args: {
  templates: ShiftTemplateForDefaults[];
  businessHours?: RestaurantBusinessHours | null;
}): AvailabilityDefault[] {
  const { templates, businessHours } = args;
  const rows: AvailabilityDefault[] = [];

  for (let day = 0; day < 7; day++) {
    const matching = templates.filter((t) => t.days.includes(day));

    if (matching.length > 0) {
      let start = normalizeTime(matching[0].start_time);
      let end = normalizeTime(matching[0].end_time);
      for (let i = 1; i < matching.length; i++) {
        start = minTime(start, normalizeTime(matching[i].start_time));
        end = maxTime(end, normalizeTime(matching[i].end_time));
      }
      rows.push({
        day_of_week: day,
        start_time: start,
        end_time: end,
        is_available: true,
      });
      continue;
    }

    const bh = businessHours?.[day];
    if (bh && bh.is_closed === false) {
      rows.push({
        day_of_week: day,
        start_time: normalizeTime(bh.open),
        end_time: normalizeTime(bh.close),
        is_available: true,
      });
      continue;
    }

    rows.push({ day_of_week: day, ...CLOSED_DEFAULT });
  }

  return rows;
}
