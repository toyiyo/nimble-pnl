import { useMemo } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { ReturningGuestWeek } from '@/lib/returningGuests';
import { toChartRows } from '@/lib/returningGuests';

interface ReturningGuestsChartProps {
  readonly weeks: ReturningGuestWeek[];
  readonly campaignStart: string;
}

const WHOLE = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const money = (v: number) => `$${WHOLE.format(Math.round(v))}`;

export function ReturningGuestsChart({ weeks, campaignStart }: ReturningGuestsChartProps) {
  const rows = useMemo(() => toChartRows(weeks, campaignStart), [weeks, campaignStart]);

  return (
    <div>
      <div
        className="h-56"
        role="img"
        aria-label="Weekly spend by returning guests and new guests, with a marker at the campaign start"
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 12, right: 12, left: 12, bottom: 4 }}>
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.4} />
            <XAxis
              dataKey="weekIndex"
              interval="preserveStartEnd"
              tickFormatter={(v: number) => `Wk ${v}`}
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tickFormatter={money}
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={false}
              width={56}
            />
            <Tooltip
              labelFormatter={(v: number) => `Week ${v}`}
              formatter={(value: number, name: string) => [money(value), name]}
            />
            <Legend />
            <ReferenceLine
              x={0}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="4 4"
              label={{ value: 'Campaign start', fontSize: 11, fill: 'hsl(var(--muted-foreground))', position: 'top' }}
            />
            <Line
              type="monotone"
              dataKey="returning"
              name="Returning guests"
              stroke="hsl(var(--chart-1))"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="new"
              name="New guests"
              stroke="hsl(var(--chart-2))"
              strokeWidth={2}
              dot={{ r: 3, fill: 'hsl(var(--chart-2))' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>Weekly spend by returning guests and new guests</caption>
        <thead>
          <tr>
            <th scope="col">Week</th>
            <th scope="col">Period</th>
            <th scope="col">Returning spend</th>
            <th scope="col">New spend</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.weekStart}>
              <th scope="row">{r.weekStart}</th>
              <td>{r.period}</td>
              <td>{money(r.returning)}</td>
              <td>{money(r.new)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
