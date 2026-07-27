/**
 * Tests for the viewModeStore module singleton — the `useSyncExternalStore`
 * source of truth for Admin ↔ My Work view-mode switching.
 *
 * state = { restaurantId: string | null, mode: 'admin' | 'work', returnPath: string }
 *
 * See docs/superpowers/specs/2026-07-24-admin-work-view-mode-design.md
 * ("State model" section) for the reference-stability contract this store
 * must honor: getSnapshot() must return the SAME object reference across
 * calls unless the store was mutated + emitted in between, or React's
 * useSyncExternalStore will loop / throw "getSnapshot should be cached".
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getSnapshot,
  subscribe,
  enterWorkMode,
  exitWorkMode,
  __resetStore,
} from '@/contexts/viewModeStore';

describe('viewModeStore', () => {
  beforeEach(() => {
    __resetStore();
  });

  it('defaults to admin mode with no restaurant and empty return path', () => {
    const snapshot = getSnapshot();
    expect(snapshot.mode).toBe('admin');
    expect(snapshot.restaurantId).toBeNull();
    expect(snapshot.returnPath).toBe('');
  });

  it('getSnapshot returns a stable reference across calls with no mutation', () => {
    const first = getSnapshot();
    const second = getSnapshot();
    expect(second).toBe(first);
  });

  it('enterWorkMode sets mode/restaurantId/returnPath', () => {
    enterWorkMode('rest-1', '/dashboard');
    const snapshot = getSnapshot();
    expect(snapshot.mode).toBe('work');
    expect(snapshot.restaurantId).toBe('rest-1');
    expect(snapshot.returnPath).toBe('/dashboard');
  });

  it('enterWorkMode notifies subscribers', () => {
    let calls = 0;
    const unsubscribe = subscribe(() => {
      calls += 1;
    });
    enterWorkMode('rest-1', '/dashboard');
    expect(calls).toBe(1);
    unsubscribe();
  });

  it('exitWorkMode resets mode to admin and preserves returnPath', () => {
    enterWorkMode('rest-1', '/dashboard');
    exitWorkMode();
    const snapshot = getSnapshot();
    expect(snapshot.mode).toBe('admin');
    expect(snapshot.returnPath).toBe('/dashboard');
  });

  it('exitWorkMode notifies subscribers', () => {
    enterWorkMode('rest-1', '/dashboard');
    let calls = 0;
    const unsubscribe = subscribe(() => {
      calls += 1;
    });
    exitWorkMode();
    expect(calls).toBe(1);
    unsubscribe();
  });

  it('subscribe returns a working unsubscribe', () => {
    let calls = 0;
    const unsubscribe = subscribe(() => {
      calls += 1;
    });
    unsubscribe();
    enterWorkMode('rest-1', '/dashboard');
    expect(calls).toBe(0);
  });

  it('__resetStore restores defaults', () => {
    enterWorkMode('rest-1', '/dashboard');
    __resetStore();
    const snapshot = getSnapshot();
    expect(snapshot.mode).toBe('admin');
    expect(snapshot.restaurantId).toBeNull();
    expect(snapshot.returnPath).toBe('');
  });

  it('getSnapshot ref changes only after a mutation+emit', () => {
    const before = getSnapshot();
    enterWorkMode('rest-1', '/dashboard');
    const after = getSnapshot();
    expect(after).not.toBe(before);
    // Same reference across repeated reads once settled (no re-allocation).
    expect(getSnapshot()).toBe(after);
  });

  it('getSnapshot ref is unchanged by a no-op read between mutations', () => {
    enterWorkMode('rest-1', '/dashboard');
    const afterEnter = getSnapshot();
    getSnapshot();
    getSnapshot();
    expect(getSnapshot()).toBe(afterEnter);
    exitWorkMode();
    const afterExit = getSnapshot();
    expect(afterExit).not.toBe(afterEnter);
  });
});
