import { useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import type { ParamSpec } from '@/lib/schedulingUrlParams';

export type SetOpts = { history?: 'push' | 'replace' };

/**
 * Write many URL params in one navigation.
 * A null value deletes the param. The setter keeps other params and the hash.
 * It reads window.location at call time, so two calls in one handler both apply.
 * Do not call the setter during render.
 */
export function useSetSearchParams(): (
  patch: Record<string, string | null>,
  opts?: SetOpts,
) => void {
  const navigate = useNavigate();
  return useCallback(
    (patch, opts) => {
      const params = new URLSearchParams(window.location.search);
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) params.delete(key);
        else params.set(key, value);
      }
      const search = params.toString();
      navigate(
        {
          pathname: window.location.pathname,
          search: search ? `?${search}` : '',
          hash: window.location.hash,
        },
        { replace: (opts?.history ?? 'replace') === 'replace' },
      );
    },
    [navigate],
  );
}

/** Read and write one URL param with a typed spec. */
export function useSearchParamState<T extends string>(
  spec: ParamSpec<T>,
): [T, (next: T, opts?: SetOpts) => void] {
  const [searchParams] = useSearchParams();
  const raw = searchParams.get(spec.key);
  const { key, fallback, parse, keepDefault } = spec;
  const value = useMemo(() => parse(raw) ?? fallback, [parse, raw, fallback]);
  const setParams = useSetSearchParams();
  const setValue = useCallback(
    (next: T, opts?: SetOpts) => {
      const remove = next === fallback && !keepDefault;
      setParams({ [key]: remove ? null : next }, opts);
    },
    [setParams, key, fallback, keepDefault],
  );
  return [value, setValue];
}
