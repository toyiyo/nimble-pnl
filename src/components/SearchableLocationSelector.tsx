import { useState, useMemo } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import Fuse from "fuse.js";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface LocationOption {
  id: string;
  name: string;
}

interface SearchableLocationSelectorProps {
  value?: string;
  onValueChange: (value: string) => void;
  locations: LocationOption[];
  disabled?: boolean;
  placeholder?: string;
  onCreateNew?: (name: string) => void;
}

export function SearchableLocationSelector({
  value,
  onValueChange,
  locations,
  disabled = false,
  placeholder = "Search or create location...",
  onCreateNew,
}: Readonly<SearchableLocationSelectorProps>) {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");

  const fuse = useMemo(() => {
    return new Fuse(locations, {
      keys: ["name"],
      threshold: 0.3,
      includeScore: true,
    });
  }, [locations]);

  const filteredLocations = useMemo(() => {
    if (!searchValue) return locations;
    const results = fuse.search(searchValue);
    return results.map((result) => result.item);
  }, [searchValue, fuse, locations]);

  const selectedLocation = locations.find((loc) => loc.id === value);

  const getDisplayValue = () => {
    if (value === "new_location") return "+ Create New Location";
    if (selectedLocation) return selectedLocation.name;
    return placeholder;
  };

  const handleSelect = (locationId: string) => {
    if (locationId === "new_location" && onCreateNew) {
      onCreateNew(searchValue.trim());
      setOpen(false);
      setSearchValue("");
      return;
    }
    onValueChange(locationId);
    setOpen(false);
    setSearchValue("");
  };

  const canCreate =
    !!onCreateNew && searchValue.trim().length > 0 &&
    !locations.some((loc) => loc.name.toLowerCase() === searchValue.trim().toLowerCase());

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
          disabled={disabled}
        >
          <span className={cn(
            "truncate",
            value === "new_location" && "text-blue-600 font-medium"
          )}>
            {getDisplayValue()}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full sm:w-[400px] p-0 bg-background border shadow-md z-50" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={placeholder}
            value={searchValue}
            onValueChange={setSearchValue}
          />
          <CommandList className="max-h-72 overflow-y-auto overscroll-contain">
            <CommandEmpty>
              <div className="py-6 text-center text-sm">
                <p className="text-muted-foreground">No locations found</p>
              </div>
            </CommandEmpty>
            {canCreate && (
              <CommandGroup heading="Actions">
                <CommandItem
                  value="new_location"
                  onSelect={() => handleSelect("new_location")}
                  className="cursor-pointer font-medium text-blue-600"
                >
                  <Plus className="mr-2 h-4 w-4 flex-shrink-0" />
                  <span>+ Create "{searchValue.trim()}"</span>
                </CommandItem>
              </CommandGroup>
            )}
            {filteredLocations.length > 0 && (
              <CommandGroup heading="Existing Locations">
                {filteredLocations.map((loc) => (
                  <CommandItem
                    key={loc.id}
                    value={loc.id}
                    onSelect={() => handleSelect(loc.id)}
                    className="cursor-pointer"
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4 flex-shrink-0",
                        value === loc.id ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span className="font-medium truncate">{loc.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
