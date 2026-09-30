import { useEffect, useRef, useState } from 'react';
import { usePostHog } from 'posthog-js/react';

const VIEW_THRESHOLD = 0.5;

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
    viewedRef.current = new Set();

    if (!ready || typeof IntersectionObserver === 'undefined' || sectionIds.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting || entry.intersectionRatio < VIEW_THRESHOLD) {
            return;
          }

          const sectionId = (entry.target as HTMLElement).id;
          if (!sectionId) {
            return;
          }

          setActiveSection(sectionId);

          if (!viewedRef.current.has(sectionId)) {
            viewedRef.current.add(sectionId);
            posthogRef.current?.capture('dashboard_section_viewed', { section_id: sectionId });
          }
        });
      },
      { threshold: VIEW_THRESHOLD },
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
