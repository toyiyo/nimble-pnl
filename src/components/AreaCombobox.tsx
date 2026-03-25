import { useState } from 'react';
import { Check, ChevronsUpDown, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useEmployeeAreas, DEFAULT_AREAS } from '@/hooks/useEmployeeAreas';

interface AreaComboboxProps {
  restaurantId: string | null;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function AreaCombobox({
  restaurantId,
  value,
  onValueChange,
  placeholder = 'Select area...',
  disabled = false,
  className,
}: AreaComboboxProps) {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const { areas, isLoading } = useEmployeeAreas(restaurantId);

  // Combine existing areas with default suggestions, dedup case-insensitive
  const allAreas = Array.from(
    new Set([
      ...areas,
      ...DEFAULT_AREAS.filter(
        (defaultArea) =>
          !areas.some(
            (area) => area.toLowerCase() === defaultArea.toLowerCase()
          )
      ),
    ])
  ).sort((a, b) => a.localeCompare(b));

  const handleSelect = (selectedValue: string) => {
    onValueChange(selectedValue);
    setOpen(false);
    setSearchValue('');
  };

  const handleCreateNew = () => {
    if (!searchValue.trim()) return;
    onValueChange(searchValue.trim());
    setOpen(false);
    setSearchValue('');
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onValueChange('');
  };

  const filteredAreas = allAreas.filter((area) =>
    area.toLowerCase().includes(searchValue.toLowerCase())
  );

  const exactMatch = filteredAreas.find(
    (area) => area.toLowerCase() === searchValue.toLowerCase()
  );
  const showCreateOption = searchValue.trim() && !exactMatch;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Select employee area"
          className={cn('w-full justify-between', className)}
          disabled={disabled}
        >
          <span className={cn(!value && 'text-muted-foreground')}>
            {value || placeholder}
          </span>
          <div className="flex items-center gap-1 ml-2">
            {value && (
              <X
                className="h-3.5 w-3.5 shrink-0 opacity-50 hover:opacity-100"
                onClick={handleClear}
              />
            )}
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search or type new area..."
            value={searchValue}
            onValueChange={setSearchValue}
          />
          <CommandList>
            <CommandEmpty>
              {isLoading ? 'Loading areas...' : 'No areas found.'}
            </CommandEmpty>
            {filteredAreas.length > 0 && (
              <CommandGroup heading={areas.length > 0 ? "Existing Areas" : "Suggested Areas"}>
                {filteredAreas.map((area) => (
                  <CommandItem
                    key={area}
                    value={area}
                    onSelect={() => handleSelect(area)}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        value === area ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    {area}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {showCreateOption && (
              <CommandGroup heading="Create New">
                <CommandItem
                  onSelect={handleCreateNew}
                  className="text-primary"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Create "{searchValue.trim()}"
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
