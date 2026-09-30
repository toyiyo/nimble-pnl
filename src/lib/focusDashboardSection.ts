interface FocusDashboardSectionOptions {
  reducedMotion: boolean;
}

/**
 * Scroll a dashboard section to the top of the view and move the keyboard
 * focus to it. Without the focus move, the next Tab key goes back to the
 * section rail, not into the section. A section gets `tabindex="-1"` so it
 * can take focus but does not become a Tab stop.
 */
export function focusDashboardSection(
  sectionId: string,
  { reducedMotion }: FocusDashboardSectionOptions,
): void {
  const section = document.getElementById(sectionId);
  if (!section) return;

  section.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
  if (!section.hasAttribute('tabindex')) {
    section.setAttribute('tabindex', '-1');
  }
  section.focus({ preventScroll: true });
}
