import React, { useState } from 'react';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
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
import { useEmployeePositions } from '@/hooks/useEmployeePositions';

interface PositionComboboxProps {
  restaurantId: string | null;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

// Default positions to suggest if no positions exist yet
const DEFAULT_POSITIONS = [
  'Server',
  'Cook',
  'Bartender',
  'Host',
  'Manager',
  'Dishwasher',
  'Chef',
  'Busser',
];

export function PositionCombobox({
  restaurantId,
  value,
  onValueChange,
  placeholder = 'Select position...',
  disabled = false,
  className,
}: PositionComboboxProps) {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const { positions, isLoading } = useEmployeePositions(restaurantId);

  // Combine existing positions with default suggestions
  // Remove duplicates (case-insensitive)
  const allPositions = Array.from(
    new Set([
      ...positions,
      ...DEFAULT_POSITIONS.filter(
        (defaultPos) =>
          !positions.some(
            (pos) => pos.toLowerCase() === defaultPos.toLowerCase()
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

  const filteredPositions = allPositions.filter((position) =>
    position.toLowerCase().includes(searchValue.toLowerCase())
  );

  const exactMatch = filteredPositions.find(
    (position) => position.toLowerCase() === searchValue.toLowerCase()
  );
  const showCreateOption = searchValue.trim() && !exactMatch;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Select employee position"
          className={cn('w-full justify-between', className)}
          disabled={disabled}
        >
          {value || placeholder}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search or type new position..."
            value={searchValue}
            onValueChange={setSearchValue}
          />
          <CommandList>
            <CommandEmpty>
              {isLoading ? 'Loading positions...' : 'No positions found.'}
            </CommandEmpty>
            {filteredPositions.length > 0 && (
              <CommandGroup heading={positions.length > 0 ? "Existing Positions" : "Suggested Positions"}>
                {filteredPositions.map((position) => (
                  <CommandItem
                    key={position}
                    value={position}
                    onSelect={() => handleSelect(position)}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        value === position ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    {position}
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
