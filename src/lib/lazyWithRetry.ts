import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

type ModuleDefault<T> = { default: T };
export type ComponentFactory<T extends ComponentType<unknown>> = () => Promise<ModuleDefault<T>>;

const RELOAD_GUARD_KEY = 'lazyWithRetry:reloaded';

type GuardStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface LoadOptions {
  retries?: number;
  retryDelayMs?: number;
  reloadOnFail?: boolean;
  storage?: GuardStorage;
  reload?: () => void;
  isNative?: boolean;
}

function safeSessionStorage(): GuardStorage | undefined {
  try {
    return window.sessionStorage;
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
    storage = safeSessionStorage(),
    reload = () => window.location.reload(),
    isNative = detectNative(),
    // Native (Capacitor) ships the bundle in-app; sessionStorage clears on cold
    // launch, so an auto-reload would loop forever. Surface to the error boundary.
    reloadOnFail = !isNative,
  } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const mod = await factory();
      storage?.removeItem(RELOAD_GUARD_KEY);
      return mod;
    } catch (err) {
      lastError = err;
      if (attempt < retries) await delay(retryDelayMs);
    }
  }

  const alreadyReloaded = storage?.getItem(RELOAD_GUARD_KEY) === '1';
  if (reloadOnFail && !alreadyReloaded) {
    storage?.setItem(RELOAD_GUARD_KEY, '1');
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
