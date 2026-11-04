import { useEffect, useRef, useState } from 'react';
import { usePostHog } from 'posthog-js/react';

const VIEW_THRESHOLD = 0.5;
// Fire the observer callback at several points as a section crosses the
// viewport, not only at 0.5. A single threshold of 0.5 also caps the ratio
// the observer ever reports for a section taller than 2x the viewport, since
// intersectionRatio is relative to the target's own height.
const OBSERVER_THRESHOLDS = [0, 0.1, 0.25, 0.5, 0.75, 1];
// The sticky app header is 56px tall and each section uses scroll-mt-24
// (96px). A section becomes active when its top edge passes this line.
export const ACTIVATION_LINE_PX = 120;
const PAGE_BOTTOM_TOLERANCE = 2;

/**
 * Track which dashboard section is in view.
 *
 * The active section follows the scroll position: it is the last section
 * whose top edge is above ACTIVATION_LINE_PX. The first id is the default.
 * An IntersectionObserver watches each section id and sends one
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

  // Views: send one dashboard_section_viewed event per section per mount.
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
        entries.forEach((entry) => {
          const sectionId = (entry.target as HTMLElement).id;
          if (!entry.isIntersecting || !sectionId || viewedRef.current.has(sectionId)) {
            return;
          }

          // intersectionRatio is relative to the section's own height, so a
          // section taller than 2x the viewport never reaches VIEW_THRESHOLD.
          // Also accept the share of the viewport height that the section
          // fills. The test double fakes only intersectionRatio.
          const viewportHeight = typeof window !== 'undefined' ? window.innerHeight || 1 : 1;
          const viewportCoverage = entry.intersectionRect
            ? entry.intersectionRect.height / viewportHeight
            : entry.intersectionRatio;

          if (entry.intersectionRatio >= VIEW_THRESHOLD || viewportCoverage >= VIEW_THRESHOLD) {
            viewedRef.current.add(sectionId);
            posthogRef.current?.capture('dashboard_section_viewed', { section_id: sectionId });
          }
        });
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

  // Active section: the last section whose top edge is above the
  // activation line. At the top of the page no section is above the line,
  // so the first section stays active. At the bottom of the page the last
  // section becomes active, because it can not scroll up to the line.
  useEffect(() => {
    if (!ready || typeof window === 'undefined' || sectionIds.length === 0) {
      return;
    }

    let frameId: number | null = null;

    const updateActiveSection = () => {
      frameId = null;
      const scrollElement = document.documentElement;
      const atPageBottom =
        window.innerHeight + window.scrollY >= scrollElement.scrollHeight - PAGE_BOTTOM_TOLERANCE;

      let nextActiveId = sectionIds[0];
      sectionIds.forEach((sectionId) => {
        const element = document.getElementById(sectionId);
        if (element && element.getBoundingClientRect().top <= ACTIVATION_LINE_PX) {
          nextActiveId = sectionId;
        }
      });

      if (atPageBottom && scrollElement.scrollHeight > window.innerHeight) {
        nextActiveId = sectionIds[sectionIds.length - 1];
      }

      setActiveSection(nextActiveId);
    };

    const scheduleUpdate = () => {
      if (frameId === null) {
        frameId = window.requestAnimationFrame(updateActiveSection);
      }
    };

    updateActiveSection();
    // Capture scroll events from any scroll container, not only the window.
    document.addEventListener('scroll', scheduleUpdate, { capture: true, passive: true });
    window.addEventListener('resize', scheduleUpdate, { passive: true });

    return () => {
      document.removeEventListener('scroll', scheduleUpdate, { capture: true });
      window.removeEventListener('resize', scheduleUpdate);
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [sectionIds, ready]);

  return activeSection;
}
