# Inventory Page Performance Optimization

**Date:** 2026-02-04
**Status:** Approved
**Author:** Claude + Jose

## Problem Statement

The inventory page becomes slow with 300+ items:
- 3.5s blocking the main thread during initial render
- 166ms image decode tasks competing for CPU
- Layout thrashing as cards mount in batches
- Janky scrolling when many items are in view

## Performance Targets

| Metric | Current | Target |
|--------|---------|--------|
| Time to Interactive | ~4s | < 800ms |
| First Contentful Paint | ~2s | < 400ms |
| Scroll performance | Janky (frame drops) | 60fps smooth |

## Solution Overview

1. **Virtualize the product grid** - Only render ~12-18 visible cards at a time
2. **Lazy load images** - Load images only when cards enter viewport
3. **Optimize image delivery** - Use proper sizing via Supabase transforms

## Technical Design

### 1. Virtualization with @tanstack/react-virtual

Instead of rendering 300+ cards, render only what's visible plus a small overscan buffer.

**Responsive behavior:**

| Viewport | Columns | Visible Rows | Cards in DOM |
|----------|---------|--------------|--------------|
| Mobile (<768px) | 1 | ~4-5 | ~8-10 |
| Tablet (768-1024px) | 2 | ~3-4 | ~12-14 |
| Desktop (>1024px) | 3 | ~3-4 | ~15-18 |

**Key details:**
- Dynamic row height measurement (cards vary based on content)
- Overscan of 3 rows ensures smooth scrolling
- Recalculates on window resize for responsive columns

**What remains unaffected:**
- Summary calculations (Total Inventory Cost/Value) - computed from full products array
- Filter counts ("Showing X of Y") - filteredProducts array stays complete
- All existing card functionality (edit, waste, transfer buttons)

### 2. Lazy Image Loading

Images load only when their card enters the viewport:

**Features:**
- Intersection Observer triggers load ~200px before visible
- Skeleton placeholder during load
- Fade-in transition on load complete
- Error fallback handling

**Image sizing optimization:**
```
Before: product-images/xyz.jpg (1200x1200, 400kb)
After:  product-images/xyz.jpg?width=128&quality=75 (128x128, ~15kb)
```

## Files to Create

| File | Purpose |
|------|---------|
| `src/components/ui/lazy-image.tsx` | Reusable lazy-loading image with placeholder |
| `src/components/inventory/VirtualizedProductGrid.tsx` | Virtualized grid wrapper |

## Files to Modify

| File | Changes |
|------|---------|
| `src/pages/Inventory.tsx` | Replace product grid section with VirtualizedProductGrid |
| `package.json` | Add `@tanstack/react-virtual` dependency |

## Implementation Order

1. Install dependency: `npm install @tanstack/react-virtual`
2. Create `lazy-image.tsx` - standalone, testable immediately
3. Create `VirtualizedProductGrid.tsx` - encapsulates virtualization logic
4. Update `Inventory.tsx` - swap in the new grid

## Rollback Plan

The virtualized grid is a drop-in replacement. Reverting is a single-line change back to the current `.map()` approach.

## Testing Checklist

- [ ] Initial load < 800ms with 300+ items
- [ ] Smooth 60fps scrolling through full list
- [ ] Images load as cards scroll into view
- [ ] Mobile single-column layout works correctly
- [ ] Window resize adjusts columns properly
- [ ] All card actions (edit, waste, transfer, delete) still work
- [ ] Filters and sorting work correctly
- [ ] Summary calculations remain accurate
- [ ] Empty state displays when no products match filter
