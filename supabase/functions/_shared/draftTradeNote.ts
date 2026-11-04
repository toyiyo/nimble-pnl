// Tentative note for a trade whose offered shift is not published yet.
// The check is `=== false` on purpose: a trade row read before the
// is_published embed existed has the field undefined, and undefined must
// not read as tentative.

export const TENTATIVE_NOTE =
  'Tentative: this shift is on a draft schedule and can still change.';

export function tentativeEmailBlock(isPublished: boolean | null | undefined): string {
  if (isPublished !== false) return '';
  return `
      <div style="background-color: #fffbeb; border-left: 4px solid #f59e0b; padding: 12px 16px; border-radius: 8px; margin: 0 0 24px 0;">
        <p style="color: #92400e; font-size: 14px; margin: 0;">${TENTATIVE_NOTE}</p>
      </div>`;
}

export function tentativePushBody(base: string, isPublished: boolean | null | undefined): string {
  return isPublished === false ? `${base} ${TENTATIVE_NOTE}` : base;
}
