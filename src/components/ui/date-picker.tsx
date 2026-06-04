import * as React from "react";
import { format } from "date-fns";
import type { Matcher } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export interface DatePickerProps {
  /** Currently selected date, or undefined when empty. */
  value: Date | undefined;
  /** Called with the picked date, or undefined when the day is deselected. */
  onChange: (date: Date | undefined) => void;
  /** Day matcher(s) forwarded to react-day-picker to disable days. */
  disabled?: Matcher | Matcher[];
  /** Trigger placeholder when no value is set. */
  placeholder?: string;
  /** date-fns format string for the trigger label. */
  dateFormat?: string;
  /** Initial month to display; defaults to `value` so the calendar opens on it. */
  defaultMonth?: Date;
  /** Popover alignment relative to the trigger. */
  align?: "start" | "center" | "end";
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  /** Extra classes for the default trigger button. */
  triggerClassName?: string;
  /** Optional custom trigger (a single element; rendered via Radix `asChild`). */
  children?: React.ReactElement;
}

export function DatePicker({
  value,
  onChange,
  disabled,
  placeholder = "Pick a date",
  dateFormat = "PPP",
  defaultMonth,
  align = "start",
  id,
  triggerClassName,
  children,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledby,
}: Readonly<DatePickerProps>) {
  const [open, setOpen] = React.useState(false);

  const handleSelect = (date: Date | undefined) => {
    if (date) {
      // Real pick: update and close (immediate feedback).
      onChange(date);
      setOpen(false);
    } else {
      // Deselect (re-click of the selected day): clear but keep the popover
      // open so the user sees the cleared state instead of a silent close+wipe.
      onChange(undefined);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {children ?? (
          <Button
            id={id}
            type="button"
            variant="outline"
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledby}
            className={cn(
              "w-full justify-start text-left font-normal",
              !value && "text-muted-foreground",
              triggerClassName,
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" aria-hidden="true" />
            {value ? format(value, dateFormat) : placeholder}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align={align}>
        <Calendar
          mode="single"
          selected={value}
          defaultMonth={defaultMonth ?? value}
          disabled={disabled}
          onSelect={handleSelect}
        />
      </PopoverContent>
    </Popover>
  );
}
