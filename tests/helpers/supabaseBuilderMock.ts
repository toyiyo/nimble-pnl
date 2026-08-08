/**
 * A stand-in for Supabase's PostgREST query builder that never settles.
 *
 * The real builder is chainable *and* thenable: `supabase.from(t).select(...)`
 * returns the builder, `.eq()`/`.gte()`/`.order()`/`.range()` return it again,
 * and awaiting it fires the request. A mock that returns a bare Promise from
 * the first call breaks the chain — the next `.eq()` is `undefined` and the
 * query rejects instead of hanging, so a test meant to observe the *loading*
 * state silently observes the error state instead.
 *
 * This proxy returns itself for every property access and exposes a `then` that
 * never invokes its callbacks, so any chain of any length parks in `isLoading`.
 */
export function neverResolvingBuilder(): unknown {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        // Thenable, but the resolve/reject callbacks are never called, so
        // `await` on the builder hangs for the lifetime of the test.
        if (prop === 'then') return () => {};
        return () => proxy;
      },
    },
  );
  return proxy;
}
