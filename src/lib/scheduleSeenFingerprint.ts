/**
 * "Has my schedule changed since I last looked?"
 *
 * There is no server-side per-user read tracking anywhere in the schema, and
 * adding it is a real feature (table, RLS, write-on-view). This is the v1
 * stand-in: a client-side fingerprint of what the employee last saw, compared
 * against what they're seeing now.
 *
 * This is not the manual caching of server data CLAUDE.md prohibits. Nothing
 * here is ever read *instead of* a query — the shifts always come from React
 * Query, and this only decides whether to draw a pill on top of them. If
 * localStorage is unavailable (private browsing, some native webviews) every
 * function degrades to "no pill" rather than throwing.
 */

const KEY_PREFIX = 'schedule_seen_';

/** Keys accumulate one per week ever viewed, so old ones are pruned on write. */
const RETENTION_WEEKS = 8;
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

export interface FingerprintShift {
  id: string;
  start_time: string;
  end_time: string;
  position: string;
  status: string;
}

export interface FingerprintInput {
  publishedAt: string | null;
  shifts: FingerprintShift[];
}

/**
 * A change-detection fingerprint, not a security boundary — FNV-1a is plenty.
 * Anyone who can forge this can already write the localStorage key directly.
 */
function hash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Sorted by shift id so a reordered query result is not mistaken for a change.
 * The fields are the ones an employee would act on — a shift moving, changing
 * position, or being cancelled all have to register.
 */
export function computeScheduleFingerprint({ publishedAt, shifts }: FingerprintInput): string {
  const rows = shifts
    .map((s) => [s.id, s.start_time, s.end_time, s.position, s.status])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return hash(JSON.stringify({ publishedAt, rows }));
}

export function scheduleSeenKey(
  restaurantId: string,
  employeeId: string,
  weekStartISO: string
): string {
  return `${KEY_PREFIX}${restaurantId}_${employeeId}_${weekStartISO}`;
}

function safeStorage(): Storage | null {
  try {
    const storage = globalThis.localStorage;
    // Touching the object is not enough — Safari's private mode throws on the
    // first write, not on access.
    const probe = `${KEY_PREFIX}probe`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

export function readSeenFingerprint(
  restaurantId: string,
  employeeId: string,
  weekStartISO: string
): string | null {
  const storage = safeStorage();
  if (!storage) return null;
  try {
    return storage.getItem(scheduleSeenKey(restaurantId, employeeId, weekStartISO));
  } catch {
    return null;
  }
}

/**
 * Prunes any `schedule_seen_*` key whose week is more than eight weeks behind
 * `now`. Cheap and synchronous, and it keeps the namespace bounded over an
 * employee's whole tenure without a migration or a scheduled job.
 */
export function writeSeenFingerprint(
  restaurantId: string,
  employeeId: string,
  weekStartISO: string,
  fingerprint: string,
  now: Date = new Date()
): void {
  const storage = safeStorage();
  if (!storage) return;

  try {
    const cutoff = now.getTime() - RETENTION_WEEKS * MS_PER_WEEK;
    const stale: string[] = [];

    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith(KEY_PREFIX)) continue;
      const weekSegment = key.slice(key.lastIndexOf('_') + 1);
      const weekTime = Date.parse(`${weekSegment}T00:00:00Z`);
      // An unparseable segment is not ours to interpret; leaving it costs one
      // key, whereas deleting it could drop something another feature owns.
      if (!Number.isNaN(weekTime) && weekTime < cutoff) stale.push(key);
    }

    stale.forEach((key) => storage.removeItem(key));
    storage.setItem(scheduleSeenKey(restaurantId, employeeId, weekStartISO), fingerprint);
  } catch {
    // Quota exceeded, or storage disabled mid-session. The pill is cosmetic;
    // failing to record "seen" only means it shows once more than needed.
  }
}

/**
 * True when the week looks different from what this employee last acknowledged.
 *
 * A first-ever view is deliberately NOT "updated" — an employee opening their
 * schedule for the first time has nothing to have missed, and a pill there
 * would train them to ignore it.
 */
export function hasScheduleChangedSinceSeen(
  stored: string | null,
  current: string
): boolean {
  return stored !== null && stored !== current;
}
