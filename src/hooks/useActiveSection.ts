import { useEffect, useRef, useState } from 'react';
import { usePostHog } from 'posthog-js/react';

const VIEW_THRESHOLD = 0.5;
// Fire the observer callback at several points as a section crosses the
// viewport, not only at 0.5. A single threshold of 0.5 also caps the ratio
// the observer ever reports for a section taller than 2x the viewport, since
// intersectionRatio is relative to the target's own height.
const OBSERVER_THRESHOLDS = [0, 0.1, 0.25, 0.5, 0.75, 1];

/**
 * Track which dashboard section is in view.
 *
 * The hook watches each section id with an IntersectionObserver. It sets
 * the first id as the active section by default. It sends one
 * `dashboard_section_viewed` event per section per mount, the first time
 * that section crosses the view threshold.
 *
 * Pass a stable `sectionIds` array (for example from `useMemo`) so the
 * observer effect does not re-run every render. Pass `ready = false` while
 * the section elements are still hidden behind a loading skeleton; the
 * effect re-runs and re-observes once `ready` becomes true, so sections
 * that mount after the initial render still get observed.
 */
export function useActiveSection(sectionIds: string[], ready = true): string | null {
  const [activeSection, setActiveSection] = useState<string | null>(
    sectionIds[0] ?? null,
  );
  const posthog = usePostHog();
  const posthogRef = useRef(posthog);
  posthogRef.current = posthog;
  const viewedRef = useRef<Set<string>>(new Set());
  const prevSectionIdsRef = useRef<string[] | null>(null);

  if (process.env.NODE_ENV !== 'production') {
    const prevSectionIds = prevSectionIdsRef.current;
    if (
      prevSectionIds !== null &&
      prevSectionIds !== sectionIds &&
      prevSectionIds.length === sectionIds.length &&
      prevSectionIds.every((id, index) => id === sectionIds[index])
    ) {
      console.warn(
        'useActiveSection: sectionIds changed reference but not content. ' +
          'Pass a memoized array (for example from useMemo) to avoid ' +
          'a needless re-observe on every render.',
      );
    }
    prevSectionIdsRef.current = sectionIds;
  }

  useEffect(() => {
    // Keep ids already marked viewed when the observer rebuilds (for example
    // when sectionIds changes as a query moves from loading to loaded data).
    // Drop ids for sections that no longer exist, so a section can fire
    // again if it is removed and later comes back.
    const nextSectionIds = new Set(sectionIds);
    viewedRef.current = new Set(
      Array.from(viewedRef.current).filter((id) => nextSectionIds.has(id)),
    );

    if (!ready || typeof IntersectionObserver === 'undefined' || sectionIds.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        // A single callback batch can report several sections above the
        // view threshold at once (for example on first layout). Pick the
        // most-visible one as active, not just the last entry in the
        // batch, so the rail highlights the section the user actually
        // sees most.
        let mostVisibleId: string | null = null;
        let mostVisibleCoverage = -1;

        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            return;
          }

          const sectionId = (entry.target as HTMLElement).id;
          if (!sectionId) {
            return;
          }

          // intersectionRatio is relative to the target's own height, so a
          // section taller than 2x the viewport can never cross
          // VIEW_THRESHOLD. intersectionRect is viewport-relative, so use
          // the share of the viewport height the section fills instead —
          // that stays reachable no matter how tall the section is. The
          // test double only fakes intersectionRatio, so fall back to it
          // when intersectionRect is not present.
          const viewportHeight = typeof window !== 'undefined' ? window.innerHeight || 1 : 1;
          const viewportCoverage = entry.intersectionRect
            ? entry.intersectionRect.height / viewportHeight
            : entry.intersectionRatio;

          const crossesViewThreshold =
            entry.intersectionRatio >= VIEW_THRESHOLD || viewportCoverage >= VIEW_THRESHOLD;

          if (crossesViewThreshold && !viewedRef.current.has(sectionId)) {
            viewedRef.current.add(sectionId);
            posthogRef.current?.capture('dashboard_section_viewed', { section_id: sectionId });
          }

          if (viewportCoverage > mostVisibleCoverage) {
            mostVisibleCoverage = viewportCoverage;
            mostVisibleId = sectionId;
          }
        });

        if (mostVisibleId) {
          setActiveSection(mostVisibleId);
        }
      },
      { threshold: OBSERVER_THRESHOLDS },
    );

    sectionIds.forEach((sectionId) => {
      const element = document.getElementById(sectionId);
      if (element) {
        observer.observe(element);
      }
    });

    return () => {
      observer.disconnect();
    };
  }, [sectionIds, ready]);

  return activeSection;
}
