import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

type ModuleDefault<T> = { default: T };
export type ComponentFactory<T extends ComponentType<unknown>> = () => Promise<ModuleDefault<T>>;

const RELOAD_GUARD_KEY = 'lazyWithRetry:reloaded';

type GuardStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface LoadOptions {
  retries?: number;
  retryDelayMs?: number;
  reloadOnFail?: boolean;
  /**
   * Override the guard storage. Pass `null` to explicitly simulate unavailable
   * storage (e.g., private browsing in tests); omit to use sessionStorage.
   */
  storage?: GuardStorage | null;
  reload?: () => void;
  isNative?: boolean;
}

function safeSessionStorage(): GuardStorage | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

function detectNative(): boolean {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function loadModuleWithRetry<T extends ComponentType<unknown>>(
  factory: ComponentFactory<T>,
  options: LoadOptions = {},
): Promise<ModuleDefault<T>> {
  const {
    retries = 1,
    retryDelayMs = 300,
    reload = () => globalThis.location.reload(),
    isNative = detectNative(),
    // Native (Capacitor) ships the bundle in-app; sessionStorage clears on cold
    // launch, so an auto-reload would loop forever. Surface to the error boundary.
    reloadOnFail = !isNative,
  } = options;

  // Resolve storage: explicit null means "no storage available" (e.g., tests
  // simulating private browsing); undefined (default) means "use sessionStorage".
  const storage: GuardStorage | null =
    'storage' in options ? (options.storage ?? null) : (safeSessionStorage() ?? null);

  // A negative `retries` would skip the loop entirely, leaving `lastError` unset
  // so the final `throw lastError` would throw `undefined`. Clamp to >= 0 so at
  // least one attempt always runs.
  const maxAttempts = Math.max(0, retries);
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    try {
      const mod = await factory();
      storage?.removeItem(RELOAD_GUARD_KEY);
      return mod;
    } catch (err) {
      lastError = err;
      if (attempt < retries) await delay(retryDelayMs);
    }
  }

  // When sessionStorage is unavailable (private browsing, restricted WebViews,
  // corporate policies), `storage` is null and the guard key can never be written.
  // Treating unavailable storage as "already reloaded" prevents an infinite reload
  // loop: without a writable guard, reload() would fire on every boot after a
  // persistent failure.
  const alreadyReloaded = storage === null || storage.getItem(RELOAD_GUARD_KEY) === '1';
  if (reloadOnFail && !alreadyReloaded) {
    storage.setItem(RELOAD_GUARD_KEY, '1');
    reload();
    // Hang so React keeps the Suspense fallback until the reload swaps the page.
    return new Promise<ModuleDefault<T>>(() => {});
  }
  storage?.removeItem(RELOAD_GUARD_KEY);
  throw lastError;
}

export function lazyWithRetry<T extends ComponentType<unknown>>(
  factory: ComponentFactory<T>,
  options?: LoadOptions,
): LazyExoticComponent<T> {
  return lazy(() => loadModuleWithRetry(factory, options));
}
