"""Single versioned API contract for validation, persistent runs, and results."""

from __future__ import annotations

import gzip
import json
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..config import Settings, get_settings
from ..database import IdempotencyConflict, RunStore
from ..schemas import (
    CANCELLABLE_STATUSES,
    DatasetSummary,
    RunAccepted,
    RunRequest,
    ResultsResponse,
    RunStatus,
    RunStatusResponse,
    ScenarioConfig,
    Severity,
    ValidateRequest,
    ValidateResponse,
)
from ..security import AuthUser, current_user
from ..services.dataset_loader import load_bundled, validate_dataset
from ..services.input_adapter import MappingError, adapt, build_manifest
from ..services.model_runner import gurobi_readiness
from ..services.result_processor import build_results_response

router = APIRouter(prefix="/api/v1", tags=["solver-v1"])
_stores: dict[str, RunStore] = {}


def get_store(settings: Settings = Depends(get_settings)) -> RunStore:
    key = str(settings.database_path)
    if key not in _stores:
        _stores[key] = RunStore(settings)
    return _stores[key]


def _issue(code: str, message: str, field: str | None = None) -> dict:
    return {
        "severity": "error",
        "code": code,
        "sheet": "scenario",
        "column": field,
        "message": message,
    }


def validate_scenario(scenario: ScenarioConfig, settings: Settings) -> ValidateResponse:
    baseline = load_bundled(settings.dataset_dir)
    issues = validate_dataset(baseline)
    if any(issue.severity is Severity.error for issue in issues):
        return ValidateResponse(valid=False, issues=issues, dataset=DatasetSummary())
    try:
        staged, resolved = adapt(baseline, scenario)
    except MappingError as exc:
        return ValidateResponse(
            valid=False,
            issues=[_issue(exc.code, exc.message)],  # type: ignore[list-item]
            dataset=DatasetSummary(),
        )
    issues.extend(validate_dataset(staged))
    if any(issue.severity is Severity.error for issue in issues):
        return ValidateResponse(valid=False, issues=issues, dataset=DatasetSummary())
    preview = build_manifest(
        baseline,
        staged,
        scenario,
        resolved,
        solver_module=settings.solver_module_path,
        baseline_manifest=settings.baseline_manifest_path,
    )
    return ValidateResponse(
        valid=True,
        issues=issues,
        dataset=DatasetSummary(
            tables=[
                {"name": item.name, "rows": item.rows, "columns": len(item.columns)}
                for item in preview.staged_tables
            ]
        ),
        resolved_configuration=resolved.as_dict(),
        manifest_preview=preview,
    )


@router.post("/validate", response_model=ValidateResponse)
def validate(
    request: ValidateRequest,
    _: AuthUser = Depends(current_user),
    settings: Settings = Depends(get_settings),
) -> ValidateResponse:
    return validate_scenario(request.scenario, settings)


@router.post("/runs", response_model=RunAccepted, status_code=status.HTTP_202_ACCEPTED)
def create_run(
    request: RunRequest,
    _: AuthUser = Depends(current_user),
    settings: Settings = Depends(get_settings),
    store: RunStore = Depends(get_store),
) -> RunAccepted:
    validation = validate_scenario(request.scenario, settings)
    if not validation.valid:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={
                "code": "scenario_invalid",
                "message": "The scenario failed authoritative backend validation.",
                "issues": [item.model_dump(by_alias=True) for item in validation.issues],
            },
        )
    _, active = store.queue_counts()
    readiness = gurobi_readiness(settings, allow_probe=active == 0)
    if not readiness.ready:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "gurobi_not_ready", "message": readiness.message},
        )
    try:
        row, duplicate = store.create_or_get(request)
    except IdempotencyConflict as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "idempotency_conflict", "message": str(exc)},
        ) from exc
    return RunAccepted(run_id=row["id"], status=RunStatus(row["status"]), duplicate=duplicate)


def _require_run(store: RunStore, run_id: str) -> dict:
    row = store.get(run_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "run_not_found", "message": "This run does not exist."},
        )
    return row


def _status_response(row: dict) -> RunStatusResponse:
    summary = json.loads(row["summary_json"]) if row.get("summary_json") else {}
    run_status = RunStatus(row["status"])
    return RunStatusResponse(
        run_id=row["id"],
        project_id=row.get("project_id"),
        status=run_status,
        progress=int(row.get("progress") or 0),
        message=row.get("message"),
        error=row.get("error_message"),
        error_code=row.get("error_code"),
        created_at=datetime.fromisoformat(row["created_at"]),
        updated_at=datetime.fromisoformat(row["updated_at"]),
        started_at=datetime.fromisoformat(row["started_at"]) if row.get("started_at") else None,
        finished_at=datetime.fromisoformat(row["finished_at"]) if row.get("finished_at") else None,
        dataset=DatasetSummary(),
        input_hash=row["input_hash"],
        termination_condition=summary.get("termination_condition"),
        objective_value=summary.get("objective_value"),
        solve_seconds=summary.get("solve_seconds"),
        cancellable=run_status in CANCELLABLE_STATUSES,
    )


@router.get("/runs", response_model=list[RunStatusResponse])
def list_runs(
    project_id: str | None = Query(None),
    _: AuthUser = Depends(current_user),
    store: RunStore = Depends(get_store),
) -> list[RunStatusResponse]:
    return [_status_response(row) for row in store.list_runs(project_id)]


@router.get("/runs/{run_id}", response_model=RunStatusResponse)
def get_run(
    run_id: str,
    _: AuthUser = Depends(current_user),
    store: RunStore = Depends(get_store),
) -> RunStatusResponse:
    return _status_response(_require_run(store, run_id))


@router.post("/runs/{run_id}/cancel", response_model=RunStatusResponse)
def cancel_run(
    run_id: str,
    _: AuthUser = Depends(current_user),
    store: RunStore = Depends(get_store),
) -> RunStatusResponse:
    row = _require_run(store, run_id)
    run_status = RunStatus(row["status"])
    if run_status not in CANCELLABLE_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "not_cancellable", "message": "This run has already finished."},
        )
    updated = store.request_cancel(run_id)
    return _status_response(updated or row)


@router.get(
    "/runs/{run_id}/results",
    response_model=ResultsResponse,
    response_model_exclude_none=True,
)
def get_results(
    run_id: str,
    variable: str | None = Query(None, max_length=100),
    page: int = Query(1, ge=1),
    page_size: int = Query(2500, ge=1, le=10_000),
    _: AuthUser = Depends(current_user),
    store: RunStore = Depends(get_store),
):
    row = _require_run(store, run_id)
    if row["status"] != RunStatus.completed.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "results_unavailable",
                "message": f"This run is '{row['status']}' and has no completed results.",
            },
        )
    artifact = Path(row.get("result_artifact") or "")
    if not artifact.is_file():
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail={"code": "result_missing", "message": "The persisted result file is missing."},
        )
    try:
        with gzip.open(artifact, "rt", encoding="utf-8") as handle:
            payload = json.load(handle)
        scenario = ScenarioConfig.model_validate_json(row["scenario_json"])
        return build_results_response(
            payload,
            row,
            scenario,
            page=page,
            page_size=page_size,
            variable=variable,
        )
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "result_invalid", "message": "The persisted result file is invalid."},
        ) from exc
