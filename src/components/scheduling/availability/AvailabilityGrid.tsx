import { Checkbox } from '@/components/ui/checkbox';
import { TimeInput } from '@/components/scheduling/TimeInput';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export type AvailabilityRowValue = {
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_available: boolean;
};

interface AvailabilityGridProps {
  value: AvailabilityRowValue[];      // length 7, sorted by day_of_week 0..6
  onChange: (next: AvailabilityRowValue[]) => void;
  idPrefix: string;                    // e.g. "bulk-avail" or "employee-avail"
}

export function AvailabilityGrid({ value, onChange, idPrefix }: AvailabilityGridProps) {
  function updateRow(index: number, patch: Partial<AvailabilityRowValue>) {
    const next = value.slice();
    next[index] = { ...next[index], ...patch };
    onChange(next);
  }

  return (
    <table className="w-full border-collapse">
      <caption className="sr-only">Weekly availability</caption>
      <thead>
        <tr>
          <th scope="col" className="sr-only">Day</th>
          <th scope="col" className="sr-only">Available</th>
          <th scope="col" className="sr-only">Start time</th>
          <th scope="col" className="sr-only">End time</th>
        </tr>
      </thead>
      <tbody>
        {value.map((row, index) => {
          const dayLabel = DAY_LABELS[row.day_of_week];
          const checkboxId = `${idPrefix}-day-${row.day_of_week}`;
          return (
            <tr key={row.day_of_week} className="border-b border-border/40">
              <th scope="row" className="py-2 pr-3 text-left text-[13px] font-medium text-foreground">
                {dayLabel}
              </th>
              <td className="py-2 pr-3 align-middle">
                <Checkbox
                  id={checkboxId}
                  checked={row.is_available}
                  onCheckedChange={(checked) =>
                    updateRow(index, { is_available: checked === true })
                  }
                  aria-label={`${dayLabel} available`}
                  className="min-h-[20px] min-w-[20px]"
                />
              </td>
              <td className="py-2 pr-2 align-middle">
                <TimeInput
                  id={`${idPrefix}-start-${row.day_of_week}`}
                  label={`${dayLabel} start`}
                  value={row.start_time.slice(0, 5)}
                  onChange={(v) => updateRow(index, { start_time: `${v}:00` })}
                />
              </td>
              <td className="py-2 align-middle">
                <TimeInput
                  id={`${idPrefix}-end-${row.day_of_week}`}
                  label={`${dayLabel} end`}
                  value={row.end_time.slice(0, 5)}
                  onChange={(v) => updateRow(index, { end_time: `${v}:00` })}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
