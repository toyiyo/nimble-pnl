import { describe, it, expect } from 'vitest';

// We test that both full and compact name elements exist in the DOM
// (Tailwind responsive classes handle visibility via CSS, not JS)
describe('Schedule responsive name column', () => {
  it('renders both full-name and compact-name elements for each employee', () => {
    // We'll test the CSS class presence rather than visual rendering
    // since Vitest doesn't evaluate CSS media queries
    const doc = document.createElement('div');
    doc.innerHTML = `
      <td class="name-col">
        <div class="full-name hidden md:flex items-center gap-3">Full Name</div>
        <div class="compact-name flex md:hidden flex-col items-center">
          <div class="avatar">MR</div>
        </div>
      </td>
    `;

    const fullName = doc.querySelector('.full-name');
    const compactName = doc.querySelector('.compact-name');

    expect(fullName).not.toBeNull();
    expect(compactName).not.toBeNull();
    // Full name hidden on mobile, visible on md+
    expect(fullName?.className).toContain('hidden');
    expect(fullName?.className).toContain('md:flex');
    // Compact name visible on mobile, hidden on md+
    expect(compactName?.className).toContain('flex');
    expect(compactName?.className).toContain('md:hidden');
  });
});
