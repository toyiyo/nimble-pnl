// Parse a `yyyy-MM-dd` string as local-zone midnight. Native `new
// Date('yyyy-MM-dd')` reads bare date strings as UTC, which shifts
// `.getDate()`/`.getDay()` back a day for restaurants in negative UTC
// offsets — we want the calendar day (and weekday) the date string
// represents. (date-fns' `parseISO` doesn't have this problem — it already
// reads date-only strings at local midnight — but this module avoids the
// dependency for a one-line parse.)
export function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}
