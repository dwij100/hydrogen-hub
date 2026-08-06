# Solver modification report — v5

## Why the previous build failed

Version 4 modified the solver source in memory before import to replace a fixed
big-M value. The normal model-build tests imported the unmodified file, so that
runtime-only path was not covered. Version 5 removes source rewriting entirely
and imports the staged solver through the same standard loader exercised by the
regression suite.

## Solver changes

1. Removed the maximum-demand billing subsystem (`maxdemand_block`). It was
   mathematically disconnected from the hydrogen objective and from the physical
   electricity balance. It added one maximum-demand binary per bus and hour
   (118 × 24 = 2,832 binaries), plus billing variables and constraints, without
   changing the operational solution. Removing it eliminates the problematic
   big-M formulation rather than increasing or bypassing a bound.
2. Removed `counton_gen` and `countoff_gen`. They were declared integer variables
   but never appeared in any objective or constraint.
3. Removed `idle`. It was declared as a binary storage variable but never used.
4. Removed the unused `from cplex import *` import and stopped generating the
   per-run `cplex.py` compatibility shim. Gurobi remains the only solver backend.
5. Kept all physical hydrogen, plant, pipeline, electricity, unit commitment,
   storage, vehicle, solar, railway, and emissions equations active.
6. Added a regression test that stages the exact licensed smoke scenario, loads
   it through `runner_entry._load_solver`, and builds the model through the same
   path used in production.
7. Enhanced the setup smoke test to print the exact sanitized build exception if
   model construction fails again.

## Expected effect

The change does not ignore large user scenarios or relax physical requirements.
It removes a disconnected reporting-only MILP subsystem and three unused variable
families. This reduces model size and should improve build and solve performance.
