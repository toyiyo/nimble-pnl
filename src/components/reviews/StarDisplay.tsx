interface StarDisplayProps {
  rating: number;
  className?: string;
  /** Wrapper element — `span` for inline row use, `p` for the detail pane's block layout. */
  as?: 'span' | 'p';
}

/**
 * Read-only 1–5 star glyph display, shared by the feedback list row and detail pane.
 *
 * `role="img"` is what makes the aria-label stick. On a bare `span` or `p` —
 * a generic or paragraph role — ARIA does not guarantee the label replaces the
 * contents, so a screen reader is free to read "★★☆☆☆" out as the raw glyph
 * names, or as nothing at all. Naming it an image makes the label the whole
 * accessible name and hides the decorative characters behind it.
 */
export function StarDisplay({ rating, className, as: Tag = 'span' }: StarDisplayProps) {
  return (
    <Tag className={className} role="img" aria-label={`${rating} out of 5 stars`}>
      <span aria-hidden="true">
        {'★'.repeat(rating)}
        <span className="text-muted-foreground/40">{'☆'.repeat(5 - rating)}</span>
      </span>
    </Tag>
  );
}
