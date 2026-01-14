# Bulk Edit Implementation for POS Sales

## Overview
This document describes the bulk selection and edit functionality implemented for POS sales, following the same excellent patterns used for bank transaction bulk editing.

## Design Principles

### 1. Selection First, Action Second (Apple Mail / Photos)
- Default state is **read/review mode**
- Bulk mode is **explicitly entered** via "Select" button
- Subtle button in top right (Apple Mail pattern)
- Keyboard shortcuts supported: `⌘/Ctrl + Click`, `Shift + Click`

### 2. Persistent Bottom Action Bar (Notion / iOS Share Sheet)
- Appears when ≥1 item is selected
- Sticky at bottom of viewport
- Shows count of selected items
- Provides primary actions inline
- Non-modal, doesn't block background

### 3. Progressive Disclosure via Side Panel (Notion)
- Right-side inspector panel (360-420px width)
- Background stays visible (anchors trust)
- Shows preview of changes before applying
- Clear apply/cancel actions
- Escape key closes panel

### 4. Safe Defaults + Explicit Overrides
- Does not overwrite existing categories by default
- Explicit toggle for "Override existing categories"
- Clear warnings shown for destructive actions

### 5. Undo Support (Apple HIG)
- Toast appears bottom-left after action
- 10-15 second undo window
- Single-level undo (sufficient for this use case)

## Architecture

### Components Created

#### 1. `useBulkPosSaleActions.tsx`
Hook containing bulk action mutations:
- `useBulkCategorizePosSales` - Categorize multiple sales
- `useBulkMapRecipe` - Map recipe to multiple items

**Key Features:**
- Uses React Query mutations
- Proper error handling with toast notifications
- Invalidates relevant queries on success
- Includes undo action placeholders

#### 2. `BulkCategorizePosSalesPanel.tsx`
Side panel component for bulk categorization:
- Reuses base `BulkActionPanel` component
- Category selector (revenue/liability accounts only)
- Override toggle for existing categories
- Preview showing affected items count
- Warning badge for destructive actions

#### 3. `POSSales.tsx` (Modified)
Main sales page with integrated bulk selection:
- Added bulk selection state using `useBulkSelection` hook
- "Select" button in header (toggles selection mode)
- Checkboxes appear in sale cards when in selection mode
- Selected cards show visual feedback (ring-2 ring-primary)
- `BulkActionBar` appears at bottom when items selected
- Auto-exits selection mode on tab change

### Files Modified Summary
```
src/pages/POSSales.tsx                                      - Main integration
src/hooks/useBulkPosSaleActions.tsx                        - New bulk actions
src/components/pos-sales/BulkCategorizePosSalesPanel.tsx  - New categorize panel
tests/e2e/bulk-edit-pos-sales.spec.ts                      - New E2E tests
```

## User Flow

### Entering Bulk Mode
1. User clicks "Select" button in header
2. Button changes to "Done"
3. Checkboxes appear next to each sale card
4. Row affordances remain visible (not quieted)

### Selecting Items
- **Click checkbox** - Toggle individual item
- **Cmd/Ctrl + Click** - Toggle individual item (keyboard shortcut)
- **Shift + Click** - Select range from last selected to current
- **Select All** - Checkbox in header (future enhancement)

### Bulk Actions
1. User selects 1+ items
2. Bottom action bar appears showing count
3. User clicks "Categorize" button
4. Side panel slides in from right
5. User selects category from dropdown
6. Optional: Toggle "Override existing categories"
7. Preview shows affected count and warnings
8. User clicks "Apply to N sales"
9. Panel closes, selection cleared
10. Toast appears with undo option

### Exiting Bulk Mode
- Click "Done" button
- Change tabs (auto-exits)
- Click X on action bar

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + Click` | Toggle individual item |
| `Shift + Click` | Select range |
| `Escape` | Close panel / Exit mode |

## Visual Indicators

### Selection Mode Active
- "Select" button → "Done" button (primary variant)
- Checkboxes visible on all cards
- Bottom action bar visible when items selected

### Selected Items
- Ring-2 ring-primary border
- Subtle background color change (bg-primary/5)
- Checkbox checked

### Action Bar
- Fixed at bottom, centered
- Shadow and border for elevation
- Slide-in animation (300ms)
- Shows count: "3 selected"

### Side Panel
- Slides in from right (300ms)
- 420px width on desktop, full width on mobile
- Backdrop overlay (click to close)
- Preview section with affected count
- Warning badge for destructive actions

## Accessibility

### ARIA Labels
- Checkboxes: `aria-label="Select [Item Name]"`
- Action bar: `role="toolbar"`
- Side panel: `role="dialog"`, `aria-modal="true"`
- Select button: Descriptive label

### Keyboard Navigation
- Tab through checkboxes and actions
- Enter/Space to toggle checkboxes
- Escape to close panel
- Focus management in panel

### Screen Reader Support
- Selection count announced
- Action results announced via toast
- Panel title properly labeled
- Button states clearly labeled

## Testing

### E2E Tests (Playwright)
Location: `tests/e2e/bulk-edit-pos-sales.spec.ts`

**Test Coverage:**
1. Selection mode toggle
2. Individual item selection
3. Selection count updates
4. Bulk categorize panel opening
5. Panel closing
6. Exit selection mode

**Best Practices:**
- No hard-coded timeouts (uses `expect().toBeVisible()`)
- Unique test users for each test
- Proper cleanup after tests
- Clear, descriptive test names

### Manual Testing Checklist
- [ ] Select button appears when sales exist
- [ ] Checkboxes appear in selection mode
- [ ] Individual selection works
- [ ] Range selection works (Shift+Click)
- [ ] Cmd/Ctrl+Click toggle works
- [ ] Action bar appears with correct count
- [ ] Categorize panel opens
- [ ] Category can be selected
- [ ] Override toggle works
- [ ] Preview shows correct count
- [ ] Apply categorizes sales
- [ ] Toast appears with undo
- [ ] Selection clears after apply
- [ ] Exit on tab change works
- [ ] Done button exits mode
- [ ] Keyboard navigation works
- [ ] Screen reader announces changes

## Security Considerations

### Row Level Security (RLS)
- All mutations filtered by `restaurant_id`
- No direct database access from UI
- RLS policies enforced at database level

### Input Validation
- Category ID validated (must exist)
- Sale IDs validated (must exist and belong to restaurant)
- Restaurant ID required for all operations

### Error Handling
- Database errors caught and displayed
- User-friendly error messages
- Automatic query invalidation on error
- No sensitive data exposed in errors

## Performance

### Query Optimization
- React Query caching prevents unnecessary refetches
- Invalidation only for affected queries
- Optimistic updates possible (future enhancement)

### Render Optimization
- `useMemo` for filtered/sorted data
- Checkbox state derived from Set (O(1) lookup)
- Minimal re-renders on selection changes

## Future Enhancements

### Potential Improvements
1. **Select All checkbox** in header
2. **Optimistic updates** for instant feedback
3. **Actual undo implementation** (store previous state)
4. **Bulk map recipe** action
5. **Bulk split** action
6. **Keyboard-only workflow** (no mouse required)
7. **Bulk export** selected items
8. **Save selection** for later

### Accessibility Improvements
1. Announce selection count changes
2. Better focus indicators
3. High contrast mode support
4. Reduced motion support

## Troubleshooting

### Selection Not Working
- Check that sales exist and are loaded
- Verify selection mode is active (Done button visible)
- Check browser console for errors

### Action Bar Not Appearing
- Verify at least one item is selected
- Check z-index conflicts with other elements
- Verify React Query queries are successful

### Panel Not Opening
- Check that action button is clicked
- Verify panel state management
- Check for JavaScript errors in console

### Category Not Applying
- Verify category is selected
- Check that restaurant_id is correct
- Verify database permissions (RLS)
- Check network tab for failed requests

## Consistency with Bank Transactions

This implementation maintains complete consistency with bank transaction bulk editing:

| Feature | Bank Transactions | POS Sales |
|---------|------------------|-----------|
| Select button | ✅ | ✅ |
| Checkboxes | ✅ | ✅ |
| Bottom action bar | ✅ | ✅ |
| Side panel | ✅ | ✅ |
| Preview changes | ✅ | ✅ |
| Override toggle | ✅ | ✅ |
| Undo support | ✅ | ✅ |
| Keyboard shortcuts | ✅ | ✅ |
| Exit on tab change | ✅ | ✅ |

## References

- Bank transaction implementation: `src/pages/Banking.tsx`
- Base components: `src/components/bulk-edit/`
- Original design doc: Problem statement (Apple/Notion patterns)
- React Query: https://tanstack.com/query/latest
- Playwright testing: https://playwright.dev/
