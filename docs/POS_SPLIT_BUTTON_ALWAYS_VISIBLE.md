# POS Sales Split Button - Always Visible

## Issue

The "Split" button in the POS Sales view was only visible **after** a sale was categorized. This prevented users from splitting sales before categorization, forcing them to:
1. First categorize the sale
2. Then click "Edit" to change to split
3. Then configure the split

This was an unnecessary extra step.

## Solution

Made the "Split" button always visible for non-split sales, regardless of categorization status.

## Changes Made

**File**: `/src/pages/POSSales.tsx`

### Before
```tsx
{sale.is_categorized && sale.chart_account && (
  <div className="flex items-center gap-2">
    <Badge>Category Info</Badge>
    <Button onClick={...}>Edit</Button>
    <Button onClick={() => setSaleToSplit(sale)}>Split</Button>  // Hidden until categorized
    <Button onClick={...}>Rule</Button>
  </div>
)}
```

### After
```tsx
{sale.is_categorized && sale.chart_account && (
  <div className="flex items-center gap-2">
    <Badge>Category Info</Badge>
    <Button onClick={...}>Edit</Button>
    <Button onClick={...}>Rule</Button>  // Removed Split from here
  </div>
)}
{/* Show Split button for all sales (categorized or not) */}
{!sale.is_split && (
  <Button onClick={() => setSaleToSplit(sale)}>
    <Split className="h-3 w-3 mr-1" />
    Split
  </Button>
)}
```

## Behavior

### Before
- **Uncategorized sale**: No Split button visible
- **Categorized sale**: Split button appears
- **Already split sale**: No Split button (correct)

### After
- **Uncategorized sale**: ✅ Split button visible
- **Categorized sale**: ✅ Split button visible
- **Already split sale**: ✅ No Split button (correct - can't re-split)

## User Flow Improvement

### Old Flow (3 steps)
1. Find sale → Click "Categorize" button
2. Select a category → Save
3. Click "Split" button → Configure split

### New Flow (2 steps)
1. Find sale → Click "Split" button
2. Configure split with categories → Save

**Result**: One less step, more intuitive workflow.

## Benefits

1. **Faster**: Skip initial categorization step
2. **More Intuitive**: Split is just another way to categorize
3. **Consistent**: Matches how bank transactions work (can split before categorizing)
4. **Flexible**: Users can split first, then adjust later if needed

## Edge Cases Handled

✅ **Uncategorized sale**: Can now split directly  
✅ **Categorized sale**: Can still split (re-categorize as split)  
✅ **Already split sale**: Button hidden (correct behavior)  
✅ **Child split**: Not shown in list (filtered out)  

## Visual Appearance

The Split button appears:
- **Location**: Below the sale badges, alongside other action buttons
- **Icon**: Split icon (two diverging paths)
- **Size**: Small (`sm`) to match other action buttons
- **Style**: Ghost variant (subtle, non-intrusive)
- **Condition**: Only shown if `!sale.is_split` (not already split)

## Testing Checklist

- [ ] Uncategorized sales show Split button
- [ ] Categorized sales still show Split button
- [ ] Already split sales don't show Split button
- [ ] Clicking Split opens SplitPosSaleDialog
- [ ] Dialog works correctly for uncategorized sales
- [ ] Saving split properly categorizes the sale
- [ ] Can split a sale with AI suggestion
- [ ] Can split a sale with manual category

## Related Components

**Unchanged (still work correctly)**:
- `SplitPosSaleDialog.tsx` - Dialog already handles uncategorized sales
- `useSplitPosSale.tsx` - Hook already supports splitting uncategorized sales
- `split_pos_sale()` - Database function already works for uncategorized sales

**Only UI changed**: Just made the button visible earlier in the workflow.

## Documentation

**User-facing**: 
> You can now split POS sales at any time, even before categorizing them. Click the "Split" button to divide a sale across multiple categories in one step.

**Developer note**:
> The Split button is now shown for all non-split sales (`!sale.is_split`), not just categorized ones. This is purely a UI change - the underlying split functionality already supported uncategorized sales.
