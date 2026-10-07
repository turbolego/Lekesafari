# Lekesafari Bug Fix Summary

## Issues Fixed

### 1. Search returning 0 results for "Solbakken"
**Root cause**: Equipment filter bug
- When no equipment is selected, the select element returns `['']` (array with empty string) instead of `[]` (empty array)
- The filter logic `if (filters.equipment.length > 0)` evaluates to true for `['']`
- `filters.equipment.some(e => pEquip.includes(e))` always returns false because empty string is not in any equipment type
- This causes ALL playgrounds to be filtered out

**Fix** (app-leaflet.js, lines 402 and 425):
1. In `getActiveFilters()`: Filter out empty strings
   ```js
   const selected = Array.from(eqSelect.selectedOptions).map(o => o.value).filter(v => v !== '');
   filters.equipment = selected;
   ```

2. In `filterPlaygrounds()`: Skip filter when it only contains empty strings
   ```js
   if (filters.equipment.length > 0 && filters.equipment.some(e => e)) {
     const pEquip = p.equipment?.map(e => e.type) || [];
     if (!filters.equipment.some(e => pEquip.includes(e))) return false;
   }
   ```

**Commits**: `b47ad9e`

### 2. Map markers not rendering (showing only 3 seed playgrounds)
**Root cause**: `syncMapMarkers()` was called BEFORE `renderPlaygroundList()` in several code paths

`syncMapMarkers()` uses `state.filteredPlaygrounds` if it exists (truthy). When:
1. Initial state: seed data loads, `renderPlaygroundList()` sets `state.filteredPlaygrounds` to 3 items
2. Data loads: `state.playgrounds` has 1630 items, but `syncMapMarkers()` uses stale `state.filteredPlaygrounds`
3. Order must be: `renderPlaygroundList()` (updates filters) → `syncMapMarkers()` (uses updated filters)

**Fix**: Swap order in all code paths within `loadFromViewport()`
- Lines 155-156 (live zoom, success)
- Lines 165-166 (live zoom, error)
- Lines 176-177 (non-live zoom)
- Lines 188-189 (non-live zoom, error)

**Commits**: `7ce17a0`, `04a0e41`

### 3. Cache versioning
Bumped cache version from v=4 to v=5 to ensure fresh deployment after fixes.

**Commits**: `b1df1d7`

## Testing

### Test files added:
- `test-search.html` - Tests for search functionality
- `test-fix-verification.html` - Verifies equipment filter and render/sync order fixes

### Verification:
1. Equipment filter with no selection returns all playgrounds (not empty)
2. Equipment filter with specific selection works correctly
3. Markers render when data loads (not just seed data)
4. Catch block error handling preserves render/sync order

## Commits Summary

```
20d2157 Add fix verification test for equipment filter and render/sync order
04a0e41 Fix catch block render/sync order: renderPlaygroundList() before syncMapMarkers()
b1df1d7 Bump cache version to v=5
7ce17a0 Fix map markers rendering - swap render/sync order
b47ad9e Fix search: filter empty equipment values to avoid blocking results
```

## Notes

- All fixes are in `app-leaflet.js` (lines 402, 425, and render/sync order)
- Cache bumps ensure browser fetches updated code
- Test files verify the fixes work correctly
- The equipment filter fix matches the actual equipment type casing (lowercase) from GeoJSON
