import { describe, it, expect, vi, afterEach } from 'vitest';

import { focusDashboardSection } from '@/lib/focusDashboardSection';

describe('focusDashboardSection', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function addSection(id: string): HTMLElement {
    const section = document.createElement('section');
    section.id = id;
    section.scrollIntoView = vi.fn();
    document.body.appendChild(section);
    return section;
  }

  it('scrolls the section to the top with smooth motion', () => {
    const section = addSection('dash-cashflow');
    focusDashboardSection('dash-cashflow', { reducedMotion: false });
    expect(section.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });

  it('uses no motion when the user asks for reduced motion', () => {
    const section = addSection('dash-cashflow');
    focusDashboardSection('dash-cashflow', { reducedMotion: true });
    expect(section.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
  });

  it('moves the keyboard focus to the section', () => {
    const section = addSection('dash-banking');
    focusDashboardSection('dash-banking', { reducedMotion: true });
    expect(document.activeElement).toBe(section);
    expect(section.getAttribute('tabindex')).toBe('-1');
  });

  it('does not change a tabindex that the section already has', () => {
    const section = addSection('dash-banking');
    section.setAttribute('tabindex', '0');
    focusDashboardSection('dash-banking', { reducedMotion: true });
    expect(section.getAttribute('tabindex')).toBe('0');
  });

  it('does nothing when the section is not on the page', () => {
    expect(() => focusDashboardSection('dash-missing', { reducedMotion: false })).not.toThrow();
  });
});
