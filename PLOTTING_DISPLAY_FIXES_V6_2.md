# Plotting display fixes — v6.2

This release changes the result presentation only. Solver equations, constraints,
objective terms, staged inputs, Gurobi settings, and raw result values are unchanged.

## Problems corrected

1. **Stacked bars could use the wrong y-axis maximum.**
   The previous frontend used the largest individual segment when calculating the
   axis, even though the plotted bars were stacked. A total stack could therefore
   exceed the calculated domain and be clipped or receive misleading ticks.

2. **Legends and axis labels competed for the same chart area.**
   Recharts rendered the legend inside the responsive chart. Long multi-series
   legends could overlap the x-axis title and reduce the usable plotting area.

3. **The same visual was used for binary states.**
   Several binary transit series at 0 or 1 overlapped almost completely and were
   difficult to interpret.

4. **Dense line charts were difficult to distinguish.**
   Similar colours and solid lines made storage and network profiles hard to track.

5. **Sparse bar tooltips listed many restored zeros.**
   This obscured the actual activity at an hour.

## Code changes

### `src/components/wizard/StepResults.tsx`

- Uses separate x-domains:
  - bars: `0.5–24.5`, so every bar is centred on its hourly bin;
  - lines/steps: `1–24`, so profiles begin and end on the actual model hours.
- Calculates stacked-bar axis limits from the positive and negative **hourly stack
  totals**, not the largest segment.
- Moves the legend completely outside the Recharts drawing area.
- Replaces the static legend with compact series controls that can hide/show a
  series without changing the underlying result.
- Keeps at least one series visible at all times.
- Adds distinct dash patterns as well as colours for multi-series lines.
- Uses a custom tooltip that:
  - displays full units;
  - omits zero-only entries for sparse bar charts;
  - reports “No activity” when the entire hourly stack is zero.
- Renders binary results as a 24-hour activity matrix:
  - filled cell = active;
  - empty cell = inactive;
  - hatched cell = genuinely missing solver value.
- Collapses the long technical description under “Chart details” to prevent it
  from pushing the figure down the page.
- Retains the corrected 24-hour data reconstruction from v6/v6.1.
- Improves y-axis formatting for very small and very large values.

### `src/components/wizard/StepResults.test.tsx`

Added regression coverage for:

- complete hours 1–24 without inventing missing values;
- stacked-axis calculation using the hourly total;
- interactive external series controls;
- binary activity-matrix rendering;
- existing table filtering and empty/failure states.

## Validation completed in the package workspace

- Backend regression suite: `35 passed, 1 skipped`.
- Python compilation: passed.
- TypeScript/TSX syntax transpilation: passed.
- Isolated TypeScript type check with component/import stubs: passed.
- All 29 protected solver/data SHA-256 entries: passed.
- Supplied result structure validation: every plotted hour is finite and within
  the supported 1–24 horizon.

The full Docker frontend build remains the authoritative environment-specific
check and is run automatically by `Setup-Hydrogen-Hub.ps1` on the user's machine.
