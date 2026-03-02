import { cn } from '@/lib/utils';

interface DragOverlayChipProps {
  name: string;
}

/**
 * Floating ghost chip rendered inside DragOverlay during drag operations.
 * Shows only the employee name with grab-cursor, shadow, and ring
 * for clear visual feedback.
 */
export function DragOverlayChip({ name }: Readonly<DragOverlayChipProps>) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border/40 px-3 py-2 cursor-grabbing',
        'bg-background shadow-lg ring-2 ring-foreground/20',
      )}
    >
      <p className="text-[13px] font-medium text-foreground truncate">
        {name}
      </p>
    </div>
  );
}
