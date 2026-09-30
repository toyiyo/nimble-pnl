import type { MouseEvent } from 'react';

export const MAIN_CONTENT_ID = 'main-content';

/**
 * The first focusable element on the page. A keyboard user can go past the
 * sidebar and the header to the page content. The click handler moves focus
 * and does not add a hash to the URL, because some pages use the hash.
 */
export function SkipToContent() {
  function handleClick(event: MouseEvent<HTMLAnchorElement>): void {
    event.preventDefault();
    const main = document.getElementById(MAIN_CONTENT_ID);
    if (!main) return;
    main.focus();
    main.scrollIntoView({ block: 'start' });
  }

  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      onClick={handleClick}
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-2 focus:z-[60] focus:rounded-lg focus:bg-foreground focus:px-4 focus:py-2 focus:text-[13px] focus:font-medium focus:text-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
    >
      Skip to main content
    </a>
  );
}
