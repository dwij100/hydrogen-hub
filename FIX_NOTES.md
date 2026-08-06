# v5 fix notes

The v4 runtime big-M source rewrite has been removed. The solver now loads
directly, and the disconnected maximum-demand billing subsystem has been
removed from the solver itself.

See `SOLVER_MODIFICATION_REPORT.md` for the exact equations and variables
removed, the reason each removal is safe, and the new regression coverage.
