"""Persistent single-concurrency worker for queued optimization runs."""

from __future__ import annotations

import json
import logging
import os
import socket
import time
from pathlib import Path

from .config import get_settings
from .database import RunStore, utcnow
from .schemas import RunStatus, ScenarioConfig, Severity
from .services.dataset_loader import load_bundled, validate_dataset
from .services.input_adapter import MappingError, adapt, stage_run
from .services.model_runner import execute, gurobi_readiness

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("hydrogen.worker")


def _finish_failure(store: RunStore, run_id: str, code: str, message: str) -> None:
    store.update(
        run_id,
        status=RunStatus.failed.value,
        progress=100,
        message="Run failed.",
        error_code=code,
        error_message=message,
        worker_pid=None,
        finished_at=utcnow(),
    )


def process_run(store: RunStore, row: dict) -> None:
    settings = store.settings
    run_id = row["id"]
    logger.info("starting run %s", run_id)
    if store.is_cancel_requested(run_id):
        store.update(
            run_id,
            status=RunStatus.cancelled.value,
            progress=100,
            message="Run cancelled.",
            finished_at=utcnow(),
        )
        return

    readiness = gurobi_readiness(settings)
    if not readiness.ready:
        _finish_failure(store, run_id, "gurobi_not_ready", readiness.message)
        return

    try:
        scenario = ScenarioConfig.model_validate_json(row["scenario_json"])
        baseline = load_bundled(settings.dataset_dir)
        baseline_errors = [
            issue for issue in validate_dataset(baseline) if issue.severity is Severity.error
        ]
        if baseline_errors:
            _finish_failure(
                store,
                run_id,
                "baseline_invalid",
                "The bundled Johor dataset failed its integrity checks.",
            )
            return
        store.update(
            run_id,
            status=RunStatus.validating.value,
            progress=12,
            message="Resolving selections and validating staged inputs.",
        )
        staged, resolved = adapt(baseline, scenario)
        staged_errors = [
            issue for issue in validate_dataset(staged) if issue.severity is Severity.error
        ]
        if staged_errors:
            _finish_failure(
                store,
                run_id,
                "adapted_inputs_invalid",
                "The selected scenario could not be converted into valid solver inputs.",
            )
            return
        run_dir = settings.runs_dir / run_id
        manifest = stage_run(
            baseline,
            staged,
            scenario,
            resolved,
            run_id=run_id,
            run_dir=run_dir,
            solver_module=settings.solver_module_path,
            baseline_manifest=settings.baseline_manifest_path,
        )
        store.update(
            run_id,
            resolved_json=json.dumps(resolved.as_dict(), sort_keys=True),
            manifest_json=manifest.model_dump_json(),
            status=RunStatus.solving.value,
            progress=25,
            message="Gurobi is solving the audited 24-hour model.",
        )

        def cancelled() -> bool:
            store.heartbeat(worker_id)
            return store.is_cancel_requested(run_id)

        def on_pid(pid: int) -> None:
            store.update(run_id, worker_pid=pid)

        def on_processing() -> None:
            store.update(
                run_id,
                status=RunStatus.processing_results.value,
                progress=90,
                message="Persisting typed results and plot data.",
            )

        outcome = execute(
            job_dir=run_dir,
            settings=settings,
            run_id=run_id,
            cancel_requested=cancelled,
            on_pid=on_pid,
            on_processing=on_processing,
        )
        final_message = {
            RunStatus.completed: "Optimization completed with an optimal solution.",
            RunStatus.cancelled: "Run cancelled.",
            RunStatus.timed_out: "Run timed out.",
            RunStatus.failed: "Run failed.",
        }[outcome.status]
        store.update(
            run_id,
            status=outcome.status.value,
            progress=100,
            message=final_message,
            summary_json=outcome.summary.model_dump_json(),
            result_artifact=str(outcome.artifact) if outcome.artifact else None,
            error_code=outcome.error_code,
            error_message=outcome.error_message,
            worker_pid=None,
            finished_at=utcnow(),
        )
    except MappingError as exc:
        _finish_failure(store, run_id, exc.code, exc.message)
    except Exception:
        logger.exception("unexpected run failure %s", run_id)
        _finish_failure(
            store,
            run_id,
            "worker_failure",
            "The worker stopped while preparing or executing this run. Review local logs.",
        )


settings = get_settings()
store = RunStore(settings)
worker_id = f"{socket.gethostname()}:{os.getpid()}"


def main() -> int:
    recovered = store.recover_interrupted()
    logger.info("worker ready; recovered %s interrupted run(s)", recovered)
    while True:
        store.heartbeat(worker_id)
        row = store.claim_next()
        if row:
            process_run(store, row)
        else:
            time.sleep(max(0.2, settings.worker_poll_seconds))


if __name__ == "__main__":
    raise SystemExit(main())
