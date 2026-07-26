/**
 * viewModeStore — module-level singleton for Admin ↔ My Work view-mode
 * switching, read via `useSyncExternalStore` from `ViewModeContext`.
 *
 * Lives outside React state deliberately: `RestaurantProvider` remounts on
 * in-app navigation, so React state anchored there would reset viewMode on
 * every route change. A module singleton survives in-app navigation but
 * resets on a full page reload / new tab (fresh module evaluation) — exactly
 * the desired lifecycle. No sessionStorage/localStorage: no secrets or PII,
 * and reload-resets-to-admin is a feature, not a bug.
 *
 * See docs/superpowers/specs/2026-07-24-admin-work-view-mode-design.md
 * ("State model" section).
 *
 * Reference-stability contract (critical for `useSyncExternalStore`):
 * `getSnapshot()` returns the SAME object reference across calls as long as
 * the store hasn't been mutated — never allocate inside the getter itself
 * (e.g. `return { ...state }`), or React will see a "new" snapshot on every
 * render and loop / throw "getSnapshot should be cached". `enterWorkMode` /
 * `exitWorkMode` replace the snapshot with a new object and notify
 * subscribers, so React's `Object.is` change-detection correctly picks up
 * real state changes while repeated reads in between stay reference-equal.
 */

export type ViewMode = 'admin' | 'work';

export interface ViewModeState {
  restaurantId: string | null;
  mode: ViewMode;
  returnPath: string;
}

type Listener = () => void;

function defaultState(): ViewModeState {
  return { restaurantId: null, mode: 'admin', returnPath: '' };
}

let snapshot: ViewModeState = defaultState();
const listeners = new Set<Listener>();

function emitChange(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Returns the current state. Stable reference until the next mutation. */
export function getSnapshot(): ViewModeState {
  return snapshot;
}

/** Registers a change listener; returns an unsubscribe function. */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Enters work mode for `restaurantId`, stashing `returnPath` so `exitWorkMode`
 * can navigate back to it. Navigation itself is owned by the caller (the
 * `ViewModeContext` provider, where `useNavigate` is available) — this store
 * only holds state.
 */
export function enterWorkMode(restaurantId: string, returnPath: string): void {
  snapshot = { restaurantId, mode: 'work', returnPath };
  emitChange();
}

/** Exits work mode back to admin. Preserves `returnPath` and `restaurantId`. */
export function exitWorkMode(): void {
  snapshot = { ...snapshot, mode: 'admin' };
  emitChange();
}

/** Test-only helper: restores the store to its default state. */
export function __resetStore(): void {
  snapshot = defaultState();
  emitChange();
}
