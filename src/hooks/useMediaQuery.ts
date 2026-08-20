import { useEffect, useState } from 'react';

/**
 * Track a CSS media query's match state. Reads `window.matchMedia` on
 * mount and updates on `change` events. Returns `false` before mount
 * (server render / no `window`).
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
