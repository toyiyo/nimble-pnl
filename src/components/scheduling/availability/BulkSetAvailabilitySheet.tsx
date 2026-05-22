import { useEffect, useMemo, useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { AvailabilityGrid, type AvailabilityRowValue } from './AvailabilityGrid';
import { useBulkSetAvailability } from '@/hooks/useBulkSetAvailability';
import { convertAvailabilityWindowsToUtc } from '@/lib/availabilityTimeUtils';

interface EmployeeLite {
  id: string;
  name: string;
  status: 'active' | 'inactive' | 'terminated';
  position?: string;
}

interface BulkSetAvailabilitySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string;
  /**
   * IANA tz of the restaurant (e.g. 'America/Chicago'). Required so the
   * local-time grid values can be converted to the UTC contract that the
   * employee_availability table follows.
   */
  restaurantTimezone: string;
  employees: EmployeeLite[];
  preCheckedIds: string[];
  defaults: AvailabilityRowValue[];   // length 7, local-time
}

export function BulkSetAvailabilitySheet({
  open,
  onOpenChange,
  restaurantId,
  restaurantTimezone,
  employees,
  preCheckedIds,
  defaults,
}: BulkSetAvailabilitySheetProps) {
  const mutation = useBulkSetAvailability();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(preCheckedIds),
  );
  const [grid, setGrid] = useState<AvailabilityRowValue[]>(defaults);

  // Re-seed when sheet (re)opens
  useEffect(() => {
    if (open) {
      setSelectedIds(new Set(preCheckedIds));
      setGrid(defaults);
    }
  }, [open, preCheckedIds, defaults]);

  const sortedEmployees = useMemo(
    () =>
      employees
        .filter((e) => e.status === 'active')
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    [employees],
  );

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedCount = selectedIds.size;
  const submitDisabled = selectedCount === 0;

  async function handleApply() {
    if (submitDisabled) return;
    try {
      await mutation.mutateAsync({
        restaurantId,
        employeeIds: Array.from(selectedIds),
        availability: convertAvailabilityWindowsToUtc(grid, restaurantTimezone),
      });
      onOpenChange(false);
    } catch {
      // hook surfaces a destructive toast already
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl flex flex-col gap-0 p-0"
      >
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <SheetTitle>Set default availability</SheetTitle>
          <SheetDescription>
            Apply a default weekly availability to selected employees.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          {/* Employee list */}
          <section aria-label="Employees">
            <p className="mb-2 text-[12px] font-medium text-muted-foreground">
              Employees ({selectedCount} selected)
            </p>
            <ul className="space-y-1 max-h-[60vh] overflow-y-auto pr-2">
              {sortedEmployees.map((emp) => {
                const checked = selectedIds.has(emp.id);
                const id = `bulk-emp-${emp.id}`;
                return (
                  <li key={emp.id}>
                    <label
                      htmlFor={id}
                      className="flex items-center gap-3 px-2 py-2 rounded-lg cursor-pointer hover:bg-muted/50"
                    >
                      <Checkbox
                        id={id}
                        checked={checked}
                        onCheckedChange={() => toggle(emp.id)}
                        aria-label={emp.name}
                        className="min-h-[20px] min-w-[20px]"
                      />
                      <span className="text-[14px] font-medium text-foreground">
                        {emp.name}
                      </span>
                      {emp.position && (
                        <span className="text-[12px] text-muted-foreground">
                          {emp.position}
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Grid */}
          <section aria-label="Weekly availability">
            <p className="mb-2 text-[12px] font-medium text-muted-foreground">
              Weekly availability
            </p>
            <AvailabilityGrid
              value={grid}
              onChange={setGrid}
              idPrefix="bulk-avail"
            />
          </section>
        </div>

        <div className="px-6 py-4 border-t border-border/40 flex justify-end gap-2">
          <Button
            variant="ghost"
            className="min-h-[44px]"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            className="min-h-[44px]"
            onClick={handleApply}
            aria-disabled={submitDisabled || mutation.isPending}
            disabled={mutation.isPending}
            aria-label={
              submitDisabled
                ? 'Select at least one employee'
                : `Apply to ${selectedCount} employee${selectedCount === 1 ? '' : 's'}`
            }
          >
            {mutation.isPending && (
              <span
                aria-hidden="true"
                className="mr-2 h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
              />
            )}
            {submitDisabled
              ? 'Select at least one employee'
              : `Apply to ${selectedCount} employee${selectedCount === 1 ? '' : 's'}`}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
