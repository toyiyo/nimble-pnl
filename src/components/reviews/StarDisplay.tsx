interface StarDisplayProps {
  rating: number;
  className?: string;
  /** Wrapper element — `span` for inline row use, `p` for the detail pane's block layout. */
  as?: 'span' | 'p';
}

/** Read-only 1–5 star glyph display, shared by the feedback list row and detail pane. */
export function StarDisplay({ rating, className, as: Tag = 'span' }: StarDisplayProps) {
  return (
    <Tag className={className} aria-label={`${rating} out of 5 stars`}>
      {'★'.repeat(rating)}
      <span className="text-muted-foreground/40">{'☆'.repeat(5 - rating)}</span>
    </Tag>
  );
}
