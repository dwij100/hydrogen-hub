# Hydrogen Hub implementation report

## Status

**Implemented but licensed solve verification still required.**

The source package, local runtime, contract, adapter, persistent queue,
cancellation, result processing, one-click scripts and documentation are
implemented. A full licensed Gurobi optimization and browser-to-plot pass were
not executed in the build environment because it has neither Docker nor the
user's private licence. The one-time Windows setup performs all containerized
non-solve checks before it starts the application.

## Architecture

```text
Browser (localhost:8080)
        |
      Nginx
      /   \
 React     FastAPI
             |
       SQLite WAL queue  ←→  one worker
             |                    |
       persisted status       isolated inputs
       and result paths            |
                              Pyomo + Gurobi
                                   |
                          gzip JSON result artifact
```

- React stores local project configurations in browser local storage.
- FastAPI and the worker share the named `hydrogen-hub_data` Docker volume.
- SQLite persists queue/status/idempotency metadata; run folders persist inputs
  and manifests; gzip JSON artifacts persist real solver values.
- Nginx exposes only `127.0.0.1:8080`, avoiding CORS and remote-auth ambiguity.
- No Supabase solver table, migration, account, password or private key exists.

## Preserved mathematics and data

The original `HSC_operational.py`, original requirements record, and 27 Johor
CSVs are unchanged. All 29 entries match `manifest.sha256`.

The model's objective is the sum of non-negative `h2_balance` variables over H2
nodes. The accurate interface label is **Total hydrogen imbalance**, with unit
wording kept as model hydrogen units because the source does not declare a
formal objective unit. It is not a monetary cost objective.

The unchanged source imports CPLEX but references no CPLEX symbol outside its
standalone `__main__` solve selection. Each isolated run receives a generated
empty compatibility module; the preserved file remains byte-identical and
production solving uses Gurobi only.

## Supported controls

| Control | Implementation |
| --- | --- |
| Dataset | Immutable Johor 118 bundle only |
| Horizon | Fixed hours 1–24 |
| Plants | POM, WWTP, BSP, BHH catalog IDs mapped to solver IDs |
| Solar | `INF-SF-001` and `INF-SF-002` only |
| Consumers | C1–C3; selected daily kg H2 demand replaces baseline demand in a per-run copy |
| Vehicles | First N existing templates per supported type, natural numeric order |
| Railway | RFS-001/002 and first 1–3 RW templates |

Daily demand is an aggregate parameter in the unchanged model. The demand chart
displays the submitted daily amount evenly over 24 hours only for visualization
and says so explicitly; it does not pretend the model consumed an hourly demand
profile.

Unsupported calendar dates, alternative seasons, solar 3–4, liquid trailers,
editable storage/capacity and processing-approach switches are removed or
explicitly unavailable, never silently ignored.

## Persistent job behavior

- Unique local idempotency key prevents duplicate run creation across restarts.
- Atomic SQLite claims and one worker enforce one solve at a time.
- Status values are the exact v1 list documented in `docs/solver-api.md`.
- Worker heartbeat and queue counts appear in `/healthz`.
- Worker restart requeues interrupted work from fresh persisted inputs.
- Cancel terminates the entire solver process group, with forced termination
  after the grace period.
- Only `optimal` becomes completed. Time limits become timed out; all other
  non-optimal terminations fail and expose no fake results.

## Result coverage

The serializer records stable variable ID, source name, family, title, unit,
ordered index names, sign meaning, and missing/zero policy. Plot groups cover:

- plant processing and inventory;
- hydrogen inventory, pipeline flow, charge/discharge and submitted demand;
- storage state/charge/discharge;
- vehicle state, transit, loading/unloading;
- railway load/unload/state;
- solar generation and solar hydrogen;
- electrical generation and line flow.

All non-zero serialized variables are available in a filterable raw table with
explicit indices, time, unit and sign meaning. Empty series and tables show a
clear no-data message. The UI never substitutes fabricated results.

## Verification performed in this environment

| Check | Result |
| --- | --- |
| Uploaded archive inventory and cross-version comparison | Passed |
| Original SHA-256 manifest | 29/29 passed |
| Baseline 11-table schema validation | Passed |
| Deterministic adapter/demand/template self-test | Passed |
| Per-run manifest and original-data immutability | Passed |
| SQLite create/idempotency/claim/recovery self-test | Passed |
| Python source compilation | Passed |
| Frontend tests | 72 passed in 9 files |
| TypeScript `tsc --noEmit` | Passed |
| ESLint | Passed |
| Vite production build | Passed; 1.413 MB main bundle (424 KB gzip), size warning only |
| Dependency pins on public PyPI | Verified for key solver/API packages |

## Not executed here

| Check | Reason | Where it is gated |
| --- | --- | --- |
| Docker image build | Docker executable unavailable in this environment | One-time setup stops on build failure |
| Containerized backend pytest suite | Docker/Python package download unavailable here | Setup runs it before services start |
| Staged Pyomo full model build | Pyomo unavailable outside the image here | Backend pytest inside setup |
| PowerShell runtime execution | PowerShell unavailable here | Windows setup scripts report each failure |
| Full Gurobi solve | Private full licence not supplied, correctly | Health gate plus first browser run |
| Browser → solver → plots | Depends on the licensed solve | User's first real optimization |

No claim is made that a licensed solve succeeded.

## User actions

1. Keep Docker Desktop installed and running.
2. Obtain a full container-compatible Gurobi WLS/commercial licence.
3. Put it at `secrets\gurobi.lic`; do not send or commit it.
4. Run `Setup-Hydrogen-Hub.ps1` once and require `SETUP COMPLETE`.
5. Run `Check-Hydrogen-Hub.ps1` and require `Overall: READY`.
6. Perform the first browser optimization and confirm `optimal`, real objective,
   charts and tables.

After that, ordinary use is only Docker Desktop plus `Start Hydrogen Hub.bat`.

## Backup and restore

Stop the app first. To back up the persistent run volume from PowerShell in the
project folder:

```powershell
New-Item -ItemType Directory -Force .\backups | Out-Null
docker run --rm -v hydrogen-hub_data:/source:ro -v "${PWD}\backups:/backup" alpine sh -c "tar -czf /backup/hydrogen-hub-data.tar.gz -C /source ."
```

To restore intentionally, stop the app, preserve a copy of the current volume,
then run:

```powershell
docker run --rm -v hydrogen-hub_data:/target -v "${PWD}\backups:/backup:ro" alpine sh -c "find /target -mindepth 1 -delete && tar -xzf /backup/hydrogen-hub-data.tar.gz -C /target"
```

Restore deletes the current volume contents first. Browser project names/configs
are separate local browser storage and are not included in this Docker-volume
backup.

## Exact API and file changes

- Full request/response examples: `docs/solver-api.md`
- File-by-file change record: `CHANGELOG.md`
- User operations: `README-WINDOWS-SETUP.md`
