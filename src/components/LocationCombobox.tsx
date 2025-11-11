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
import { useInventoryLocations } from '@/hooks/useInventoryLocations';

interface LocationComboboxProps {
  restaurantId: string | null;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function LocationCombobox({
  restaurantId,
  value,
  onValueChange,
  placeholder = 'Select location...',
  disabled = false,
  className,
}: LocationComboboxProps) {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const { locations, isLoading, createLocation, isCreating } = useInventoryLocations(restaurantId);

  const handleSelect = (selectedValue: string) => {
    onValueChange(selectedValue === value ? '' : selectedValue);
    setOpen(false);
    setSearchValue('');
  };

  const handleCreateNew = async () => {
    if (!searchValue.trim()) return;
    
    try {
      const newLocation = await createLocation(searchValue.trim());
      onValueChange(newLocation.name);
      setOpen(false);
      setSearchValue('');
    } catch (error) {
      console.error('Error creating location:', error);
    }
  };

  const filteredLocations = locations.filter((location) =>
    location.name.toLowerCase().includes(searchValue.toLowerCase())
  );

  const selectedLocation = locations.find((location) => location.name === value);
  const exactMatch = filteredLocations.find(
    (location) => location.name.toLowerCase() === searchValue.toLowerCase()
  );
  const showCreateOption = searchValue.trim() && !exactMatch;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn('w-full justify-between', className)}
          disabled={disabled}
        >
          {selectedLocation ? selectedLocation.name : placeholder}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search or type new location..."
            value={searchValue}
            onValueChange={setSearchValue}
          />
          <CommandList>
            <CommandEmpty>
              {isLoading ? 'Loading locations...' : 'No locations found.'}
            </CommandEmpty>
            {filteredLocations.length > 0 && (
              <CommandGroup heading="Existing Locations">
                {filteredLocations.map((location) => (
                  <CommandItem
                    key={location.id}
                    value={location.name}
                    onSelect={() => handleSelect(location.name)}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        value === location.name ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    {location.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {showCreateOption && (
              <CommandGroup heading="Create New">
                <CommandItem
                  onSelect={handleCreateNew}
                  disabled={isCreating}
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
