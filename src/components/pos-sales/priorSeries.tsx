/** The legend, tooltip, and accessible-name label of the prior series. */
export const PRIOR_LABEL = 'Previous period';

/** The legend swatch of a dashed prior line. */
export function DashedSwatch() {
  return (
    <svg width="14" height="2" aria-hidden="true">
      <line x1="0" y1="1" x2="14" y2="1" stroke="currentColor" strokeWidth="2" strokeDasharray="3 2" />
    </svg>
  );
}
