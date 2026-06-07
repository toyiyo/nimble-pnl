/**
 * RouteFallback — full-screen loader shown by the top-level Suspense boundary
 * while a lazy route chunk is loading.
 *
 * Accessibility:
 * - role="status" is a polite live region; text content is required for the
 *   announcement to be meaningful (aria-label is not sufficient on its own).
 * - Any decorative SVG spinner carries aria-hidden="true".
 * - Animation is gated on motion-safe: to honour prefers-reduced-motion.
 */
export function RouteFallback() {
  return (
    <div
      role="status"
      className="flex min-h-screen items-center justify-center bg-background"
    >
      <div className="flex flex-col items-center gap-3">
        {/* Decorative spinner — hidden from assistive technology */}
        <svg
          aria-hidden="true"
          className="h-8 w-8 text-muted-foreground motion-safe:animate-spin"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>

        {/* Visible + live-region text — required so the status role announces */}
        <span className="text-[14px] text-muted-foreground">Loading…</span>
      </div>
    </div>
  );
}
