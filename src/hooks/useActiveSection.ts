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
 */
export function useActiveSection(sectionIds: string[]): string | null {
  const [activeSection, setActiveSection] = useState<string | null>(
    sectionIds[0] ?? null,
  );
  const posthog = usePostHog();
  const posthogRef = useRef(posthog);
  posthogRef.current = posthog;
  const viewedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    viewedRef.current = new Set();

    if (typeof IntersectionObserver === 'undefined' || sectionIds.length === 0) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionIds.join(',')]);

  return activeSection;
}
