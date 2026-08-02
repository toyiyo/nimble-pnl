import { useEffect, useState } from 'react';

/**
 * Trailing-edge debounce for a *displayed* value.
 *
 * Use this only for read-only display. Debouncing the underlying state would
 * delay form behaviour; debouncing the projection keeps typing responsive while
 * stopping a shared derived readout from flashing through intermediate values.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeoutId = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timeoutId);
  }, [value, delayMs]);

  return debounced;
}
