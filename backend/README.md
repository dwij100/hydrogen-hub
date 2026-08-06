# Local solver backend

The backend is a single-user FastAPI API plus a separate, single-concurrency
worker. Both share a persistent SQLite database and result volume. No Supabase
table, migration, account, password or server key is involved.

## Components

| Path | Responsibility |
| --- | --- |
| `app/main.py` | API, integrity/readiness checks |
| `app/api/solver_routes.py` | versioned `/api/v1` contract |
| `app/database.py` | SQLite WAL queue, idempotency and recovery |
| `app/worker.py` | one queued run at a time |
| `app/services/dataset_loader.py` | canonical 11-table loading and validation |
| `app/services/input_adapter.py` | deterministic mapping and isolated staging |
| `app/services/model_runner.py` | licence probe and cancellable process group |
| `app/services/runner_entry.py` | unchanged model build, Gurobi solve, artifact |
| `app/services/result_serializer.py` | typed variable metadata and sparse records |
| `app/services/result_processor.py` | charts and filterable raw table |
| `solver/` | audited solver model, pins, 27 CSVs and hash manifest |

## Data adapter

Each run starts with a deep in-memory copy of the immutable bundle. The adapter:

1. Maps UI catalog IDs to the solver IDs (`INF-POM-001` → `POM1`, etc.).
2. Rejects unknown IDs and unsupported solar farms.
3. Selects vehicle templates in natural numeric order for reproducibility.
4. Excludes the five unsupported baseline H2 tanks from staged version-1 runs.
   Their fixed start/end SOC plus hourly leakage makes reduced scenarios
   infeasible without an external replenishment path. Fixed baseline BESS rows
   remain part of the power-system data; the immutable storage CSV is unchanged.
5. Resolves facilities required by model parameters, retained storage, H2 nodes
   and vehicle locations.
6. Sets C1–C3 demand to zero, then writes the submitted daily demand for each
   selected consumer. The unchanged model consumes this as one 24-hour
   aggregate, not as an hourly profile.
7. Writes fresh CSVs into `/data/runs/<run-id>/inputs` atomically.
8. Copies the audited solver directly without a CPLEX compatibility shim
   compatibility module. The original has an unused CPLEX wildcard import but
   no CPLEX symbols; all solving is through Pyomo's Gurobi plugin.
9. Records submitted/resolved JSON and SHA-256 input manifests, including the
   retained and excluded storage-unit IDs.

The baseline is read-only in the image. A run never edits source files.

## Queue lifecycle

```text
queued → preparing → validating → solving → processing_results → completed
                                                ├→ timed_out
                                                ├→ cancelled
                                                └→ failed
```

SQLite uses WAL mode and `BEGIN IMMEDIATE` for atomic enqueue/claim operations.
The `(user_id, idempotency_key)` uniqueness constraint prevents duplicate
submission across API restarts. On worker startup, interrupted work is requeued;
a pending cancellation becomes cancelled. Cancellation sends `SIGTERM` to the
entire solver process group and escalates to `SIGKILL` after the grace period.

Only an optimal Gurobi termination becomes `completed`. Time limits become
`timed_out`; infeasible, unbounded and other non-optimal terminations become
`failed` with a safe error code. Every run log records model-build, solve,
termination and subprocess-exit markers. Infeasible runs also produce Gurobi
IIS summary/model files in the local results volume.

## Licence readiness

The readiness probe checks that `gurobipy` imports, the mounted licence exists,
and a 2,001-variable model can optimize. This distinguishes a full licence from
the size-limited pip licence. It never prints licence contents, and submission is
rejected until readiness is full.

## Tests

The setup script runs `pytest -q -p no:cacheprovider backend/tests` in the built image. The suite
covers release hashes, baseline validation, mapping, demand and vehicle
determinism, active-set closure, atomic manifests, SQLite idempotency,
claim/cancel/restart behavior, process termination, time-limit classification,
result metadata, API paths/state parity, and construction of the preserved
Pyomo model from staged inputs.

After those tests, setup runs `python -m backend.app.services.smoke_test`. It
must complete the deterministic POM1 scenario with Gurobi termination `optimal`
before setup starts/upgrades the persistent services. The first browser run then
verifies browser-to-results integration rather than discovering basic model
infeasibility after setup was already declared successful.

## API

See `docs/solver-api.md`. In packaged local mode no Authorization header is
required because the listener is bound to `127.0.0.1`. Non-local authentication
is deliberately disabled in this release rather than pretending to be secure.
