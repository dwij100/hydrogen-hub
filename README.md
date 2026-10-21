## Acknowledgements and Open-Source Notice

**Mathematical Modelling:** Hanin Izzeldin Abbas Khalil ([hanin.izzeldin@monash.edu](mailto:hanin.izzeldin@monash.edu)).

**Open Source:** All remaining work is open source and may be freely used, adapted, and distributed in accordance with the applicable licence.

# Hydrogen Hub — local Gurobi application

This package runs the Hydrogen Hub configuration interface, FastAPI service,
persistent SQLite queue, one solver worker, and Gurobi behind one local address:

```text
http://localhost:8080
```

The only private file you supply is a full Gurobi licence.

## Windows quick start

1. Install and open Docker Desktop; wait for its engine to report running.
2. Extract the whole ZIP to a normal local folder.
3. Put your private full WLS or commercial licence at
   `secrets\gurobi.lic` (exact name; not `.txt`).
4. Right-click `Setup-Hydrogen-Hub.ps1`, choose **Run with PowerShell**, or
   run this once from PowerShell:

   ```powershell
   PowerShell -NoProfile -ExecutionPolicy Bypass -File .\Setup-Hydrogen-Hub.ps1
   ```

5. When setup reports `SETUP COMPLETE`, use `Start Hydrogen Hub.bat` for
   ordinary launches.

Do not rerun setup for each optimization. The complete click-by-click guide is
in [README-WINDOWS-SETUP.md](README-WINDOWS-SETUP.md).

## What is supported

- Immutable bundled Johor 118 dataset only.
- Fixed model hours 1–24.
- POM, WWTP, BSP and BHH catalog selections.
- Solar farms `INF-SF-001` and `INF-SF-002` only.
- Consumers `CON-HC-001`–`003` with daily demand in kg H2/day.
- Deterministic existing POME, Biogas, Biomass, BioH2, 99H2, BEV and FCEV
  templates.
- Railway stations `RFS-001`–`002` and trains `RW1`–`RW3`.
- Real status polling, process cancellation, restart recovery, persisted results,
  corrected 24-hour plots, raw tables, CSV and JSON downloads.

Calendar horizons, seasonal profiles, solar farms 3–4, liquid-trailer controls,
editable plant/storage capacity and alternative processing approaches are not
represented by the audited model and are unavailable in the interface.
The five baseline H2 tanks are also excluded from staged version-1 runs because
their fixed cyclic SOC and leakage require a replenishment path that reduced
scenarios do not necessarily contain. Fixed baseline electrical storage remains.

## Mathematical identity

`backend/solver/HSC_operational.py` contains the audited v5 simplification
described in `SOLVER_MODIFICATION_REPORT.md`. Its active objective is:

```text
minimize sum(h2_balance[h] for h in H)
```

The application therefore labels the objective **Total hydrogen imbalance**,
never total cost. All 29 packaged solver/data files are checked against
`backend/solver/manifest.sha256` at startup and in tests. Plotting-only v6
changes are documented in `PLOTTING_MODIFICATION_REPORT.md`.

## Operations

| Action | File |
| --- | --- |
| One-time build and verification | `Setup-Hydrogen-Hub.ps1` |
| Normal launch | `Start Hydrogen Hub.bat` |
| Stop services without deleting data | `Stop-Hydrogen-Hub.ps1` |
| Readiness and queue check | `Check-Hydrogen-Hub.ps1` |
| Redacted recent logs | `View-Hydrogen-Hub-Logs.ps1` |

Runtime state is in the named Docker volume `hydrogen-hub_data`. Never run
`docker compose down -v` unless you intentionally want to delete stored runs.

## Development verification

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

Backend tests run inside the production image during the one-time Windows setup:

```powershell
docker compose run --rm --no-deps backend pytest -q -p no:cacheprovider backend/tests
```

Setup then performs a licensed deterministic smoke solve and requires Gurobi
termination `optimal` before it reports `SETUP COMPLETE`.

See `docs/solver-api.md`, `backend/README.md`, and `IMPLEMENTATION_REPORT.md` for
the contract, adapter, queue, result schema, and verification limits.
