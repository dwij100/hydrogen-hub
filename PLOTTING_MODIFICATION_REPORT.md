# Plotting modification report — v6

## Problem confirmed from the supplied completed run

The supplied result contains 15 chart groups. Across those charts, 73 displayed
series have fewer than 24 points and 26 series contain only one non-zero point.
The solver artifact is intentionally compact: values near zero are omitted from
the raw records. The previous chart processor treated omitted zero records as if
the time periods did not exist, so the x-axis could collapse to hours 1–6 and
one-hour dispatch events appeared as isolated points on a line chart.

## Backend changes

### Full model time axis

`backend/app/services/result_processor.py` now reads the model time set `T` from
the persisted solve artifact and falls back to the supported hours 1–24.

### Safe zero reconstruction

For a solved variable block with `missing_count == 0`, absent records are known
to be serializer-omitted near-zero values. The chart processor restores those
values as `0.0` for every displayed entity and hour.

If a block contains genuinely unset or non-finite values, the processor does
not guess. Those unresolved periods remain gaps. This preserves the distinction
between a real zero and missing solver data.

The raw-variable table remains compact and continues to list non-zero records
only.

### Meaning-based chart selection

The API result contract now includes:

- `chartType`: `line`, `step`, or `bar`
- `yAxisMode`: `auto`, `fraction`, or `binary`

The mapping is:

- **Line:** solar output, solar hydrogen output, electrical line flow.
- **Step:** demand, inventories, storage state of charge, vehicle state, railway
  state, and binary transit states.
- **Stacked bar:** plant processing, pipeline transfer, electrical generation,
  charging/discharging, and railway loading/unloading events.

A sparse one-hour event is therefore shown as an hourly bar with zero activity
in the other periods rather than as a misleading isolated line point.

### Series limits

Dense network variables can contain many entities. Charts show the largest
10–12 series by total absolute activity, depending on the variable. The chart
description states how many additional series were omitted from the visual;
all series remain available in the raw-variable table.

## Frontend changes

`src/components/wizard/StepResults.tsx` now:

- always creates numeric hour rows 1–24;
- fixes the x-domain to 1–24 with ticks at 1, 4, 8, 12, 16, 20, and 24;
- displays the x-axis title instead of discarding it;
- leaves absent backend values undefined so genuine missing data creates a gap;
- renders step states with `stepAfter`;
- renders event/dispatch series as stacked bars;
- fixes fraction and binary y-axes to 0–1;
- formats state-of-charge ticks as percentages;
- forces non-negative charts to include zero;
- gives signed charts a domain that includes zero and a visible zero reference;
- disables animation so charts render deterministically;
- formats large and very small tooltip values readably.

## Solver effect

No optimization variables, constraints, objective terms, input adapters, or
Gurobi settings were changed in v6. This release changes result processing and
presentation only. Solver outputs and the non-zero raw table are preserved.

## Existing runs

Stored completed runs benefit automatically. Each request to
`GET /api/v1/runs/{id}/results` rebuilds the chart response from the persisted
raw gzip artifact using the new plotting processor. A run does not need to be
solved again merely to obtain the corrected charts.

## Verification

- Python source compilation: passed.
- Backend regression suite: 35 passed, 1 skipped.
- Added regression coverage for full-horizon zero reconstruction.
- Added regression coverage ensuring missing values remain gaps.
- Added frontend helper coverage for a complete 1–24 x-axis without invented
  values.
- TypeScript/TSX syntax transpilation: passed.
- Full `npm ci` could not be completed in the build workspace because its
  internal npm mirror returned 404 for a locked package tarball. The Docker
  setup script remains the authoritative frontend build/test gate on the user
  machine.
