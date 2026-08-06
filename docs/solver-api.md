# Solver API v1

The local frontend and FastAPI backend use one checked-in, versioned contract.
TypeScript definitions are in `src/lib/solver/types.ts`; backend schemas are in
`backend/app/schemas.py`; `backend/tests/test_contract.py` verifies route and
run-state parity. Nginx proxies `/healthz`, `/readyz` and `/api/` to FastAPI.

## Run states

Exactly:

```text
queued
preparing
validating
solving
processing_results
completed
failed
cancelling
cancelled
timed_out
```

Only `completed` has results.

## `GET /healthz`

No authentication. It returns readiness for API, SQLite, worker heartbeat,
persistent storage, queue, Gurobi package/licence, and immutable dataset. Before
a licence is installed, the solver portion resembles:

```json
{
  "status": "degraded",
  "solver": {
    "name": "gurobi",
    "package_status": "available",
    "licence_status": "missing",
    "ready": false,
    "message": "Place a full gurobi.lic file in the project's secrets folder."
  }
}
```

Licence status is one of `missing`, `invalid`, `restricted`, `full`,
`invocation_failed`, or `unchecked`.

## `POST /api/v1/validate`

Request:

```json
{
  "scenario": {
    "dataset_id": "johor118",
    "horizon_hours": 24,
    "infrastructure_ids": ["INF-POM-001", "INF-WWTP-001", "INF-BSP-001"],
    "solar_farm_ids": ["INF-SF-001"],
    "consumers": [
      {"consumer_id": "CON-HC-001", "demand_kg_per_day": 240.0}
    ],
    "vehicles": {
      "pome_trucks": 1,
      "biogas_trucks": 1,
      "biomass_trucks": 1,
      "bioh2_trucks": 1,
      "gaseous_h2_trailers": 1,
      "bev_fleet": 0,
      "fcev_fleet": 0
    },
    "railway": {
      "enabled": true,
      "station_ids": ["RFS-001"],
      "train_count": 1
    }
  }
}
```

Successful response includes resolved solver IDs and an input-manifest preview:

```json
{
  "valid": true,
  "issues": [],
  "dataset": {
    "id": "johor118",
    "name": "Johor 118 (bundled)",
    "source": "bundled",
    "tables": []
  },
  "resolved_configuration": {
    "plants": ["POM1", "WWTP1", "BSP1"],
    "solar_farms": ["SF1"],
    "consumer_daily_demand_kg": {"C1": 240.0},
    "vehicles": ["TK1", "TK16", "TK11", "TK6", "TK21"],
    "trains": ["RW1"],
    "stations": ["Segamat Inland Port"],
    "staged_storage_units": ["BESS1", "BESS2"],
    "excluded_unsupported_storage_units": ["HT1", "HT2", "HT3", "HT4", "HT5"]
  },
  "manifest_preview": {
    "manifest_version": "1",
    "adapter_version": "1.1.0",
    "manifest_sha256": "sha256-value"
  }
}
```

Validation errors include `severity`, `code`, `table`, `field`, `row`, `value`,
`expected`, and `message` where applicable. No upload or XLSX path exists in v1.

## `POST /api/v1/runs`

Request uses the same `scenario` plus:

```json
{
  "project_id": "local-project-uuid",
  "project_name": "Johor scenario",
  "input_hash": "h46a5102f1a2",
  "idempotency_key": "5fb1421d-566f-4cb1-8a34-1f31d4f0a487",
  "scenario": {"dataset_id": "johor118", "horizon_hours": 24, "infrastructure_ids": ["INF-POM-001"], "solar_farm_ids": [], "consumers": [{"consumer_id": "CON-HC-001", "demand_kg_per_day": 240}], "vehicles": {"pome_trucks": 1, "biogas_trucks": 0, "biomass_trucks": 0, "bioh2_trucks": 0, "gaseous_h2_trailers": 0, "bev_fleet": 0, "fcev_fleet": 0}, "railway": {"enabled": false, "station_ids": [], "train_count": 0}}
}
```

Response (`202`):

```json
{
  "run_id": "f15e08fd-40b7-4aab-a2e6-a858193d91b2",
  "status": "queued",
  "duplicate": false
}
```

The same idempotency key and input hash returns the same run with
`"duplicate": true`; a different input hash returns `409`.

## `GET /api/v1/runs/{run_id}`

```json
{
  "run_id": "f15e08fd-40b7-4aab-a2e6-a858193d91b2",
  "project_id": "local-project-uuid",
  "status": "solving",
  "progress": 25,
  "message": "Gurobi is solving the preserved 24-hour model.",
  "error": null,
  "error_code": null,
  "created_at": "2026-08-05T12:00:00+00:00",
  "updated_at": "2026-08-05T12:01:00+00:00",
  "started_at": "2026-08-05T12:00:02+00:00",
  "finished_at": null,
  "dataset": {"id": "johor118", "name": "Johor 118 (bundled)", "source": "bundled"},
  "input_hash": "h46a5102f1a2",
  "solver_name": "gurobi",
  "termination_condition": null,
  "objective_value": null,
  "objective_label": "Total hydrogen imbalance",
  "solve_seconds": null,
  "cancellable": true
}
```

`GET /api/v1/runs?project_id=<id>` lists local runs.

## `POST /api/v1/runs/{run_id}/cancel`

A queued job becomes `cancelled` immediately. An executing job becomes
`cancelling` while the worker terminates the solver process group. The response
uses the run-status shape above.

## `GET /api/v1/runs/{run_id}/results`

Available only for `completed`:

```json
{
  "run_id": "f15e08fd-40b7-4aab-a2e6-a858193d91b2",
  "status": "completed",
  "solver_name": "gurobi",
  "termination_condition": "optimal",
  "objective_value": 0.0,
  "objective_label": "Total hydrogen imbalance",
  "objective_unit": "model hydrogen units",
  "solve_seconds": 812.4,
  "dataset": {"id": "johor118", "name": "Johor 118 (bundled)", "source": "bundled"},
  "input_summary": {"Dataset": "Johor 118 (bundled)", "Horizon": "24 hourly steps"},
  "charts": [{
    "key": "variable-h2_inven",
    "label": "Hydrogen inventory by node",
    "category": "flows",
    "xLabel": "Hour (1-24)",
    "unit": "kg H2",
    "chartType": "step",
    "yAxisMode": "auto",
    "series": [{
      "key": "h2_inven:0",
      "label": "node=C1",
      "unit": "kg H2",
      "points": [{"t": 1, "value": 12.5}]
    }],
    "description": "Source variable: h2_inven. Values are non-negative."
  }],
  "tables": [{
    "key": "raw-variables",
    "label": "Non-zero raw solver variables",
    "columns": ["Family", "Variable", "Title", "Unit", "Indices", "Hour", "Value", "Sign meaning", "Source variable"],
    "rows": [["hydrogen", "h2_inven", "Hydrogen inventory", "kg H2", "{\"node\":\"C1\",\"hour\":1}", 1, 12.5, "Values are non-negative.", "h2_inven"]],
    "total_rows": 1,
    "page": 1,
    "page_size": 2500,
    "truncated": false
  }]
}
```

Optional query parameters are `variable`, `page`, and `page_size` (maximum
10,000). Zeros at or below the configured tolerance and unset/non-finite values
are omitted and counted in persisted variable metadata. For chart output, omitted
zeros are reconstructed across the model time axis only when the source block has
no genuinely missing values; unset values remain gaps. `chartType` selects line,
step, or bar rendering, while `yAxisMode` selects automatic, fractional, or binary
y-axis formatting.

## Errors

```json
{
  "detail": {
    "code": "gurobi_not_ready",
    "message": "The detected Gurobi licence is size-limited and cannot run this model."
  }
}
```

Stack traces, filesystem paths, credentials and licence contents are not sent to
the browser.
