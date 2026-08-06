"""Hydrogen Hub local Solver API."""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone

from fastapi import FastAPI, Request, Response, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api.solver_routes import router as solver_router
from .config import get_settings
from .database import RunStore
from .schemas import ComponentHealth, HealthResponse, QueueHealth
from .services.dataset_loader import load_bundled, validate_dataset
from .services.model_runner import gurobi_readiness

logging.basicConfig(level=logging.INFO)
settings = get_settings()
store = RunStore(settings)

app = FastAPI(
    title="Hydrogen Hub Solver API",
    version=settings.app_version,
    description="Local persistent API for the audited Johor HSC model and Gurobi worker.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Accept", "Idempotency-Key"],
)
app.include_router(solver_router)


@app.exception_handler(RequestValidationError)
async def request_validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    """Return field-level errors without echoing submitted values or internals."""
    issues = []
    for error in exc.errors():
        location = [str(part) for part in error.get("loc", ()) if part not in {"body"}]
        issues.append(
            {
                "severity": "error",
                "code": str(error.get("type", "invalid_value")),
                "table": "scenario",
                "field": ".".join(location) or None,
                "row": None,
                "value": None,
                "expected": None,
                "message": str(error.get("msg", "Invalid configuration value.")),
            }
        )
    first = issues[0] if issues else None
    suffix = f" {first['field']}: {first['message']}" if first else ""
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        content={
            "detail": {
                "code": "request_validation_error",
                "message": f"Configuration request is invalid.{suffix}",
                "issues": issues,
            }
        },
    )


def _dataset_health() -> ComponentHealth:
    try:
        lines = settings.baseline_manifest_path.read_text(encoding="utf-8").splitlines()
        if len(lines) != 29:
            raise ValueError("manifest entry count")
        for line in lines:
            digest, separator, relative = line.partition("  ")
            if not separator:
                raise ValueError("manifest format")
            path = settings.solver_dir / relative.removeprefix("./")
            if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
                raise ValueError("hash mismatch")
        if any(issue.severity.value == "error" for issue in validate_dataset(load_bundled(settings.dataset_dir))):
            raise ValueError("dataset validation")
        return ComponentHealth(ready=True, message="All 29 release hashes and dataset checks pass.")
    except Exception:
        return ComponentHealth(ready=False, message="Solver or Johor data integrity check failed.")


def _worker_health() -> ComponentHealth:
    _, heartbeat = store.worker_state()
    if heartbeat is None:
        return ComponentHealth(ready=False, message="No worker heartbeat has been recorded.")
    age = (datetime.now(timezone.utc) - heartbeat).total_seconds()
    if age > settings.worker_stale_seconds:
        return ComponentHealth(ready=False, message="The worker heartbeat is stale.")
    return ComponentHealth(ready=True, message="The single-concurrency worker is running.")


def _storage_health() -> ComponentHealth:
    try:
        for directory in (settings.data_dir, settings.runs_dir, settings.result_dir, settings.log_dir):
            directory.mkdir(parents=True, exist_ok=True)
            probe = directory / ".write-probe"
            probe.write_text("ok", encoding="utf-8")
            probe.unlink()
        return ComponentHealth(ready=True, message="Persistent run, result, and log storage is writable.")
    except OSError:
        return ComponentHealth(ready=False, message="Persistent runtime storage is not writable.")


@app.get("/healthz", response_model=HealthResponse)
def healthz() -> HealthResponse:
    database_ready, database_message = store.database_ready()
    dataset = _dataset_health()
    worker = _worker_health()
    storage = _storage_health()
    queued, active = store.queue_counts()
    solver = gurobi_readiness(settings, allow_probe=active == 0)
    ready = all((database_ready, dataset.ready, worker.ready, storage.ready, solver.ready))
    return HealthResponse(
        status="ok" if ready else "degraded",
        version=settings.app_version,
        api=ComponentHealth(ready=True, message="Solver API is responding."),
        database=ComponentHealth(ready=database_ready, message=database_message),
        worker=worker,
        storage=storage,
        queue=QueueHealth(queued=queued, active=active),
        solver=solver,
        dataset=dataset,
    )


@app.get("/readyz")
def readyz(response: Response) -> dict[str, bool]:
    database_ready, _ = store.database_ready()
    dataset_ready = _dataset_health().ready
    ready = database_ready and dataset_ready
    if not ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {"ready": ready}
