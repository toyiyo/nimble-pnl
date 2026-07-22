// Parse a `yyyy-MM-dd` string as local-zone midnight. `parseISO` reads bare
// date strings as UTC, which shifts `.getDate()`/`.getDay()` back a day for
// restaurants in negative UTC offsets — we want the calendar day (and
// weekday) the date string represents.
export function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}
