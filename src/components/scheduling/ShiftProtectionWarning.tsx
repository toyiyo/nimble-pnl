import { AlertTriangle } from 'lucide-react';

interface ShiftProtectionWarningProps {
  /** Optional id, so a disabled control can point at the panel with aria-describedby. */
  id?: string;
  /** Optional bold first line. Use it when the panel lists several findings. */
  title?: string;
  /** One line for each finding. */
  messages: string[];
  /** Optional muted last line. It tells the reader what to do next. */
  footnote?: string;
}

/**
 * Amber panel for Shift Protection findings. Every trade and time-off
 * surface shows the findings in the same shape.
 */
export function ShiftProtectionWarning({
  id,
  title,
  messages,
  footnote,
}: Readonly<ShiftProtectionWarningProps>) {
  return (
    <div
      id={id}
      role="status"
      className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20"
    >
      <AlertTriangle
        className="h-4 w-4 text-amber-600 dark:text-amber-500 shrink-0 mt-0.5"
        aria-hidden="true"
      />
      <div className="space-y-1">
        {title && <p className="text-[13px] font-semibold text-foreground">{title}</p>}
        {messages.map((message) => (
          <p key={message} className="text-[13px] text-foreground">
            {message}
          </p>
        ))}
        {footnote && <p className="text-[12px] text-muted-foreground">{footnote}</p>}
      </div>
    </div>
  );
}
