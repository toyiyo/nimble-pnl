# Position Dropdown Implementation

## Overview
Implemented a searchable, create-enabled position combobox for the employee management section, following the same pattern used for inventory locations and suppliers throughout the application.

## Problem Statement
The employee position field used a static dropdown with 9 hardcoded positions. Users could not:
- Search through positions
- Add custom positions specific to their restaurant
- See positions from existing employees

## Solution
Created a dynamic, searchable combobox that:
1. Fetches existing positions from the employees table
2. Provides default suggestions for new restaurants
3. Allows inline creation of new positions
4. Searches with typeahead functionality

## Files Changed

### 1. src/hooks/useEmployeePositions.tsx (NEW)
```typescript
// Fetches distinct positions from employees table for the current restaurant
// Returns: { positions: string[], isLoading: boolean, error: Error }
// Uses React Query with 30s stale time
```

### 2. src/components/PositionCombobox.tsx (NEW)
```typescript
// Searchable combobox component
// Features:
// - Search existing positions
// - Show default suggestions (Server, Cook, Bartender, etc.)
// - Create new positions inline
// - Keyboard accessible
// - Case-insensitive duplicate detection
```

### 3. src/components/EmployeeDialog.tsx (MODIFIED)
```typescript
// Changes:
// - Removed POSITIONS array (12 lines)
// - Added PositionCombobox import
// - Replaced Select component with PositionCombobox
// Result: 21 lines removed, 8 lines added
```

## Usage Example

```typescript
// In EmployeeDialog
<PositionCombobox
  restaurantId={restaurantId}
  value={position}
  onValueChange={setPosition}
  placeholder="Select or type a position..."
/>
```

## User Flow

1. User clicks "Add New Employee" in Operations section
2. User clicks the Position field
3. Combobox opens showing:
   - Existing positions from their employees (if any)
   - Default suggestions (Server, Cook, Bartender, etc.)
4. User can either:
   - Select an existing position
   - Type to search positions
   - Type a new position name and click "+ Create 'Position Name'"
5. New position is saved with the employee record

## Technical Details

### Data Flow
```
useEmployeePositions hook
    ↓ (queries employees table)
Distinct positions by restaurant_id
    ↓ (merged with defaults)
PositionCombobox component
    ↓ (user selects/creates)
EmployeeDialog state (position)
    ↓ (on form submit)
employees table (position column)
```

### Default Positions
- Server
- Cook
- Bartender
- Host
- Manager
- Dishwasher
- Chef
- Busser

### Security
- Restaurant-scoped queries (RLS enforced)
- Input sanitization (trimmed)
- No SQL injection risk (Supabase client)
- No XSS vulnerabilities (React escaping)

## Benefits

1. **Better UX**: Users can search and create positions specific to their needs
2. **Consistency**: Follows the same pattern as other comboboxes (locations, suppliers)
3. **Flexibility**: Supports any position name, not limited to predefined list
4. **Smart defaults**: New restaurants get helpful suggestions
5. **Performance**: React Query caching reduces database queries

## Pattern Consistency

This implementation follows the exact pattern used in:
- `LocationCombobox` (for inventory locations)
- `SearchableSupplierSelector` (for suppliers in products)

All three share:
- Command component for search
- Popover for dropdown
- "Create new" functionality
- React Query for data fetching
- Proper accessibility attributes

## Testing

✅ Build successful (TypeScript compilation)
✅ Lint passed (ESLint validation)
✅ Manual code review completed
✅ Pattern consistency verified

## Future Enhancements (Optional)

- Add position icons/colors for visual distinction
- Track position usage statistics
- Allow position archiving/soft delete
- Position-based role permissions
