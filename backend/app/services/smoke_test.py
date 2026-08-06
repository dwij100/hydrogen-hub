"""Licensed end-to-end smoke solve used by the Windows setup script."""

from __future__ import annotations

import gzip
import json
import uuid

from ..config import get_settings
from ..schemas import RunStatus, ScenarioConfig, Severity
from .dataset_loader import load_bundled, validate_dataset
from .input_adapter import adapt, stage_run
from .model_runner import execute, gurobi_readiness


def _scenario() -> ScenarioConfig:
    """Small deterministic scenario that should remain feasible by construction."""
    return ScenarioConfig.model_validate(
        {
            "dataset_id": "johor118",
            "horizon_hours": 24,
            "infrastructure_ids": ["INF-POM-001"],
            "solar_farm_ids": [],
            "consumers": [
                {"consumer_id": "CON-HC-001", "demand_kg_per_day": 314.96},
                {"consumer_id": "CON-HC-002", "demand_kg_per_day": 28.5},
                {"consumer_id": "CON-HC-003", "demand_kg_per_day": 172.6},
            ],
            "vehicles": {
                "pome_trucks": 1,
                "biogas_trucks": 0,
                "biomass_trucks": 0,
                "bioh2_trucks": 0,
                "gaseous_h2_trailers": 0,
                "bev_fleet": 0,
                "fcev_fleet": 0,
            },
            "railway": {"enabled": False, "station_ids": [], "train_count": 0},
        }
    )


def main() -> int:
    settings = get_settings()
    readiness = gurobi_readiness(settings, force=True)
    if not readiness.ready:
        print(f"LICENSED SMOKE SOLVE FAILED: {readiness.message}", flush=True)
        return 1

    baseline = load_bundled(settings.dataset_dir)
    scenario = _scenario()
    staged, resolved = adapt(baseline, scenario)
    errors = [
        issue for issue in validate_dataset(staged) if issue.severity is Severity.error
    ]
    if errors:
        print(
            "LICENSED SMOKE SOLVE FAILED: staged input validation returned "
            f"{len(errors)} error(s).",
            flush=True,
        )
        return 1

    run_id = f"setup-smoke-{uuid.uuid4()}"
    run_dir = settings.runs_dir / run_id
    stage_run(
        baseline,
        staged,
        scenario,
        resolved,
        run_id=run_id,
        run_dir=run_dir,
        solver_module=settings.solver_module_path,
        baseline_manifest=settings.baseline_manifest_path,
    )
    outcome = execute(
        job_dir=run_dir,
        settings=settings,
        run_id=run_id,
        cancel_requested=lambda: False,
        on_pid=lambda _pid: None,
        on_processing=lambda: None,
    )
    print(
        "Licensed smoke result: "
        f"status={outcome.status.value} "
        f"termination={outcome.summary.termination_condition} "
        f"objective={outcome.summary.objective_value}",
        flush=True,
    )
    if (
        outcome.status is RunStatus.completed
        and outcome.summary.termination_condition == "optimal"
        and outcome.summary.objective_value is not None
    ):
        print("LICENSED SMOKE SOLVE PASSED", flush=True)
        return 0

    print(
        f"LICENSED SMOKE SOLVE FAILED: {outcome.error_message or 'unknown failure'}",
        flush=True,
    )
    if outcome.artifact and outcome.artifact.is_file():
        try:
            with gzip.open(outcome.artifact, "rt", encoding="utf-8") as handle:
                failed_payload = json.load(handle)
            if failed_payload.get("stage") == "failed":
                error_type = str(failed_payload.get("error_type", "UnknownError"))
                error_detail = str(failed_payload.get("error_detail", ""))[:800]
                print(f"Build detail: {error_type}: {error_detail}", flush=True)
        except (OSError, json.JSONDecodeError):
            pass
    iis_summary = settings.result_dir / f"{run_id}.iis.json"
    if iis_summary.is_file():
        try:
            diagnostic = json.loads(iis_summary.read_text(encoding="utf-8"))
            constraints = diagnostic.get("constraints", [])
            print(
                "IIS constraints: "
                + ", ".join(str(value) for value in constraints[:20]),
                flush=True,
            )
            if len(constraints) > 20:
                print(
                    f"IIS constraints truncated: {len(constraints) - 20} more",
                    flush=True,
                )
            print(f"IIS summary: /data/results/{iis_summary.name}", flush=True)
        except (OSError, json.JSONDecodeError):
            pass
    print(f"Run log: /data/logs/{run_id}.log", flush=True)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
