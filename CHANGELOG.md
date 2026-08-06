# v6.3

- Fixed the accessible name of plot series toggle buttons so the frontend Vitest suite can locate the controls during the Docker build.
- No solver or plotting calculations changed.

# Changelog

## v6.2 plotting display correction

- Corrects stacked-bar y-axis limits using hourly stack totals, preventing clipped bars.
- Centres bars in complete hourly bins while retaining a 1–24 profile axis for lines and steps.
- Moves legends outside the chart and adds hide/show controls for crowded series.
- Replaces overlapping binary step lines with a 24-hour activity matrix.
- Adds line dash patterns, concise tooltips, restored-zero filtering, and collapsible chart details.
- Does not change solver equations, constraints, objectives, inputs, or result values.
- See `PLOTTING_DISPLAY_FIXES_V6_2.md` for the full audit.

## v6 plotting and time-axis correction

- Reconstructs serializer-omitted zero values across the complete 24-hour model horizon when the source block has no missing values.
- Preserves genuine missing values as gaps rather than assuming zero.
- Uses a fixed numeric hour axis from 1 to 24 and displays the x-axis label.
- Uses step charts for states, stacked bars for hourly events/dispatch, and lines for continuous profiles.
- Adds percentage/binary y-axis handling and a zero reference for signed electrical flows.
- Limits dense charts to their largest series while retaining every raw value in the table.
- Existing completed runs receive corrected charts without being solved again.
- See `PLOTTING_MODIFICATION_REPORT.md` for the full audit.

## v5 direct solver fix and model simplification

- Removed fragile runtime source rewriting.
- Removed the disconnected maximum-demand billing block and its 2,832 binaries.
- Removed unused `counton_gen`, `countoff_gen`, and `idle` variables.
- Removed the unused CPLEX import and compatibility shim.
- Added production-path model-build regression coverage.
- Added exact build-error output to the licensed setup smoke test.
- See `SOLVER_MODIFICATION_REPORT.md` for the full audit.


Compared with the supplied `Hydrogen Hub Config (4).zip`.

## v4 maximum-demand big-M feasibility fix

- Corrects a second independent infeasibility exposed after the v3 H2-tank fix.
- The unchanged solver hard-codes `M=10,000`, while the bundled B59 maximum-
  demand billing constraint can require more than `26,700`.
- `runner_entry.py` now derives a safe value from each staged power table and
  applies it in memory only; the protected solver and SHA-256 manifest remain
  byte-identical. The bundled data derives `M=33,391`.
- Run logs and result warnings disclose the correction.
- Smoke failures print IIS constraint names, and regression tests protect both
  the required bound and source-file immutability.

## v3 feasibility and diagnostics fix

- `backend/app/services/input_adapter.py` now excludes the five unsupported H2
  tanks (`HT1`–`HT5`) from each isolated version-1 run while leaving the
  protected baseline storage CSV unchanged. In v2 those tanks were retained in
  every reduced scenario; fixed 30% first/last SOC plus hourly leakage required
  H2 replenishment even when the selected scenario had no source, making the
  POM1 smoke case infeasible.
- Resolved configurations and manifests now record both staged storage units
  and excluded unsupported storage units. Fixed baseline BESS rows remain.
- `backend/app/services/runner_entry.py` records build/solve/termination phase
  markers and generates Gurobi IIS summary and `.ilp` files for infeasible runs.
- `backend/app/services/model_runner.py` records child-process exit codes and
  reports proven infeasibility specifically instead of the generic
  “did not return an optimal solution” message.
- `backend/app/services/smoke_test.py` adds a deterministic licensed POM1 solve.
  `Setup-Hydrogen-Hub.ps1` must see status `completed`, termination `optimal`,
  and a real objective value before it starts/upgrades persistent services.
- Adapter and runner regression tests cover H2-tank exclusion, immutable source
  preservation, IIS-aware classification and the existing timeout boundary.
- The protected solver, original requirements record and all 27 Johor data
  files remain byte-identical.

## Setup verification hotfix

- `backend/Dockerfile` now copies `src/lib/solver/types.ts` into the backend
  image because the contract test intentionally reads that file to verify that
  frontend run states match the backend enum. The previous image copied only
  `backend/`, causing setup to fail with `FileNotFoundError` despite the source
  file being present in the project.
- `Setup-Hydrogen-Hub.ps1` disables pytest's cache provider during the
  read-only container verification run, removing harmless permission warnings
  for `/srv/hydrogen/.pytest_cache`.
- Backend 422 responses use Starlette's current
  `HTTP_422_UNPROCESSABLE_CONTENT` name, removing the deprecation warning.

## Added

| File | Change |
| --- | --- |
| `.dockerignore` | Excludes secrets, licences, environment files, build output and local runtime data from Docker contexts. |
| `docker-compose.yml` | Defines frontend, API and single worker with health checks, restart policy and persistent volume. |
| `frontend.Dockerfile` | Reproducible Node build/test stage and Nginx runtime. |
| `docker/nginx.conf` | Same-origin SPA hosting and API/health reverse proxy. |
| `Setup-Hydrogen-Hub.ps1` | One-time checks, build, backend test, startup and full readiness gate. |
| `Start-Hydrogen-Hub.ps1` | Normal restart-safe launcher and browser opener. |
| `Start Hydrogen Hub.bat` | Double-click entry point. |
| `Stop-Hydrogen-Hub.ps1` | Stops services without deleting persistent runs. |
| `Check-Hydrogen-Hub.ps1` | Component, licence, dataset, worker and queue diagnostics. |
| `View-Hydrogen-Hub-Logs.ps1` | Redacted recent logs. |
| `README-WINDOWS-SETUP.md` | Exact click-by-click setup, first solve and troubleshooting. |
| `CHANGELOG.md` | This file-by-file record. |
| `IMPLEMENTATION_REPORT.md` | Architecture, evidence, limitations and user actions. |
| `SOLVER_MODIFICATION_REPORT.md` | Audit of the v5 solver changes and their effect. |
| `secrets/README.txt` | Safe licence placement reminder; contains no licence. |
| `package-lock.json` | Reproducible npm dependency resolution. |
| `backend/app/database.py` | SQLite WAL run queue, atomic claims, idempotency, heartbeat and recovery. |
| `backend/app/worker.py` | Persistent single-concurrency worker lifecycle. |
| `backend/app/worker_health.py` | Worker-container heartbeat health check. |
| `backend/app/services/result_processor.py` | Converts real serialized variables into charts and raw tables. |
| `backend/tests/conftest.py` | Canonical baseline/scenario fixtures. |
| `backend/tests/test_adapter.py` | Hash, schema, mapping, demand, closure and manifest tests. |
| `backend/tests/test_contract.py` | API path and frontend/backend run-state parity tests. |
| `backend/tests/test_database_queue.py` | Idempotency, claim, cancellation and recovery tests. |
| `backend/tests/test_model_build.py` | Builds the unchanged Pyomo model from adapted inputs. |
| `backend/tests/test_results.py` | Units, dimensions, missing/zero policy and plot/table tests. |
| `src/lib/localMode.ts` | Compile-time local-mode switch. |
| `src/lib/localProjects.ts` | Browser-persistent local project CRUD. |
| `src/lib/solver/scenario.ts` | Exact project-to-API scenario mapping. |
| `src/lib/solver/scenario.test.ts` | Mapping and solver-input hash regression tests. |
| `src/integrations/supabase/localMode.test.ts` | Proves local startup needs no Supabase settings. |
| `src/components/wizard/StepResults.test.tsx` | Real chart/table, filtering, empty-state and failed-run presentation tests. |

## Modified

| File | Change |
| --- | --- |
| `.env.example` | Safe Compose name, port and solve timeout only. |
| `.gitignore` | Excludes private licence, environment, database, tests and builds. |
| `README.md` | Replaced Lovable boilerplate with local application overview. |
| `backend/.env.example` | Local runtime settings; removed cloud database secrets. |
| `backend/Dockerfile` | Python 3.11 non-root Gurobi runtime and read-only baseline. |
| `backend/README.md` | Documents local adapter, queue, cancellation, results and licence gate. |
| `backend/requirements.txt` | Gurobi/API/test runtime; CPLEX is no longer a second commercial dependency. |
| `backend/app/config.py` | Local paths and environment parsing; no Supabase configuration. |
| `backend/app/schemas.py` | Strict scenario, run, health, result and manifest contract. |
| `backend/app/security.py` | Explicit loopback single-user identity boundary. |
| `backend/app/main.py` | Component health, worker heartbeat, storage and all-29-hash checks. |
| `backend/app/api/solver_routes.py` | One `/api/v1` validation/run/cancel/results contract. |
| `backend/app/services/input_adapter.py` | Deterministic IDs/templates, demand application, closure and atomic per-run files. |
| `backend/app/services/model_runner.py` | Full-licence probe, process-group cancellation, timeout and safe failure mapping. |
| `backend/app/services/runner_entry.py` | Gurobi build/solve subprocess and gzip result artifact. |
| `backend/app/services/result_serializer.py` | Stable metadata, units, dimensions, signs and missing/zero policy for model variables. |
| `backend/tests/test_model_runner.py` | Adds real process termination and time-limit-not-success tests. |
| `docs/solver-api.md` | Replaced obsolete endpoint/upload schema with exact v1 examples. |
| `package.json` | Adds explicit TypeScript check script. |
| `src/App.tsx` | Local mode bypasses remote authentication while cloud routes remain optional. |
| `src/context/HydrogenProjectContext.tsx` | Local persistence, catalog IDs and only supported transport controls. |
| `src/context/SolverRunContext.tsx` | Readiness, authoritative validation, idempotent submit, polling, recovery, cancellation and stale detection. |
| `src/components/wizard/SolverSubmitPanel.tsx` | Real component health, validation/run/cancel controls and errors. |
| `src/components/wizard/StepTimePeriod.tsx` | Fixed 24-hour horizon; unsupported dates/seasons removed. |
| `src/components/wizard/StepInfrastructure.tsx` | Catalog-backed supported assets; unsupported capacity/approach controls removed. |
| `src/components/wizard/StepTransport.tsx` | Deterministic existing templates; unsupported liquid trailer control removed. |
| `src/components/wizard/StepReview.tsx` | Exact scenario summary and hydrogen-imbalance objective. |
| `src/components/wizard/StepResults.tsx` | Real status, charts, empty-state messages, filter, CSV/JSON and no mock fallback. |
| `src/hooks/useInfrastructureData.ts` | Excludes solar farms without solver profiles. |
| `src/integrations/supabase/client.ts` | Harmless local placeholders prevent unused cloud client import failure. |
| `src/lib/solver/client.ts` | Same-origin local API, `/api/v1` routes and safe errors. |
| `src/lib/solver/types.ts` | Contract-aligned statuses, scenario, health and result types. |
| `src/lib/solver/inputHash.ts` | Hashes only inputs actually consumed by the solver. |
| `src/lib/wizardValidation.ts` | Validates only the supported mathematical configuration. |
| `src/pages/Dashboard.tsx` | Local saved-project create/open/delete flow. |
| `src/pages/HydrogenHome.tsx` | Accurate supported-scope summary. |
| `src/context/HydrogenProjectContext.test.tsx` | Updated persistence/default assertions. |
| `src/context/SolverRunContext.test.tsx` | Current health, polling, duplicate, cancel, recovery, stale and failure tests. |
| `src/lib/solver/client.test.ts` | Current route, auth, local-mode and error-envelope tests. |
| `src/lib/wizardValidation.test.ts` | Fixed horizon and supported-selection validation tests. |
| `src/pages/HydrogenWizard.test.tsx` | Removes workbook-export expectations; verifies real run gating. |

## Removed

| File | Reason |
| --- | --- |
| `.env` | Uploaded environment values must not be distributed; safe defaults are generated from `.env.example`. |
| `backend/app/job_store.py` | Replaced non-durable/incompatible job storage with SQLite `database.py`. |
| `backend/app/services/upload_reader.py` | XLSX/ZIP raw-dataset path is unsupported in the restricted v1 contract. |
| `backend/tests/test_dataset_and_adapter.py` | Replaced by focused adapter, queue, contract, build and result suites. |
| `package-script-note.md` | Obsolete workbook instructions. |
| `scripts/generateExcelData.js` | Obsolete workbook generator. |
| `src/pages/GenerateExcelFiles.tsx` | Obsolete generated-workbook page. |
| `src/utils/excelDataGenerator.ts` | Obsolete workbook result path. |
| `src/utils/generatePublicExcelFiles.ts` | Obsolete workbook generation. |
| `src/utils/initializeExcelData.ts` | Obsolete workbook initialization. |

## Deliberately unchanged

- `backend/solver/HSC_operational.py`
- `backend/solver/requirements.original.txt`
- all 27 files under `backend/solver/data/johor118/`
- `backend/solver/manifest.sha256`

`sha256sum -c backend/solver/manifest.sha256` passes all 29 entries.
