# File-by-file implementation change log

Compared with the supplied `Hydrogen Hub Config (4).zip`.

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
| `ORIGINAL_FILE_HASH_VERIFICATION.md` | Archive-to-release SHA-256 preservation evidence for all 29 immutable files. |
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
