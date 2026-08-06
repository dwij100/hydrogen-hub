"""Gurobi readiness classification and cancellable solver subprocess execution."""

from __future__ import annotations

import gzip
import json
import os
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from ..config import Settings
from ..schemas import RunStatus, RunSummary, SolverReadiness

SAFE_ERRORS = {
    "solver_unavailable": "Gurobi is not ready. Run Check-Hydrogen-Hub.ps1 for details.",
    "solver_crashed": "The solver process stopped unexpectedly. Review the local run logs.",
    "solver_timeout": "The solver exceeded the configured time limit.",
    "result_missing": "The solver stopped without producing a result artifact.",
    "model_build_failed": "The solver model could not be built from the staged inputs.",
}

_readiness_cache: tuple[float, float | None, SolverReadiness] | None = None


def gurobi_readiness(
    settings: Settings, *, force: bool = False, allow_probe: bool = True
) -> SolverReadiness:
    """Prove the licence is not the 2,000-variable restricted licence."""
    global _readiness_cache
    licence_mtime = (
        settings.gurobi_license_file.stat().st_mtime
        if settings.gurobi_license_file.is_file()
        else None
    )
    now = time.monotonic()
    if (
        not force
        and _readiness_cache
        and _readiness_cache[1] == licence_mtime
        and (now - _readiness_cache[0] < 60 or not allow_probe)
    ):
        return _readiness_cache[2]
    if not allow_probe:
        return SolverReadiness(
            package_status="available",
            licence_status="unchecked",
            ready=False,
            message="The licence probe is deferred while an optimization is active.",
        )

    try:
        import gurobipy as gp
    except Exception:
        result = SolverReadiness(
            package_status="unavailable",
            licence_status="unchecked",
            ready=False,
            message="The gurobipy package is not installed in the backend image.",
        )
    else:
        if not settings.gurobi_license_file.is_file():
            result = SolverReadiness(
                package_status="available",
                licence_status="missing",
                ready=False,
                message="Place a full gurobi.lic file in the project's secrets folder.",
            )
        else:
            os.environ["GRB_LICENSE_FILE"] = str(settings.gurobi_license_file)
            model = None
            try:
                model = gp.Model("hydrogen-hub-licence-check")
                model.Params.OutputFlag = 0
                model.addVars(2001, lb=0.0, ub=1.0, name="licence_probe")
                model.setObjective(0.0)
                model.optimize()
                result = SolverReadiness(
                    package_status="available",
                    licence_status="full",
                    ready=True,
                    message="A full Gurobi licence successfully solved the readiness probe.",
                )
            except gp.GurobiError as exc:
                message = str(exc).lower()
                if exc.errno == 10010 or "size-limited" in message or "model too large" in message:
                    status = "restricted"
                    public = "The detected Gurobi licence is size-limited and cannot run this model."
                elif "license" in message or "licence" in message:
                    status = "invalid"
                    public = "The Gurobi licence is invalid, expired, or cannot be acquired."
                else:
                    status = "invocation_failed"
                    public = "Gurobi could not complete the licence readiness probe."
                result = SolverReadiness(
                    package_status="available",
                    licence_status=status,
                    ready=False,
                    message=public,
                )
            except Exception:
                result = SolverReadiness(
                    package_status="available",
                    licence_status="invocation_failed",
                    ready=False,
                    message="Gurobi could not complete the licence readiness probe.",
                )
            finally:
                if model is not None:
                    try:
                        model.dispose()
                    except Exception:
                        pass
                # WLS commonly permits one job. Release the default environment
                # before the worker subprocess acquires its solve token.
                try:
                    gp.disposeDefaultEnv()
                except Exception:
                    pass
    _readiness_cache = (now, licence_mtime, result)
    return result


@dataclass(frozen=True)
class RunOutcome:
    status: RunStatus
    summary: RunSummary
    artifact: Path | None
    error_code: str | None = None
    error_message: str | None = None
    pid: int | None = None


def _stop_process(process: subprocess.Popen[bytes], grace_seconds: int) -> None:
    if process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=max(1, grace_seconds))
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=10)


def execute(
    *,
    job_dir: Path,
    settings: Settings,
    run_id: str,
    cancel_requested: Callable[[], bool],
    on_pid: Callable[[int], None],
    on_processing: Callable[[], None],
) -> RunOutcome:
    artifact = settings.result_dir / f"{run_id}.json.gz"
    log_path = settings.log_dir / f"{run_id}.log"
    settings.result_dir.mkdir(parents=True, exist_ok=True)
    settings.log_dir.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    env.update(
        {
            "MPLBACKEND": "Agg",
            "SOLVER_NAME": "gurobi",
            "SOLVE_TIMEOUT_SECONDS": str(settings.solve_timeout_seconds),
            "ZERO_TOLERANCE": str(settings.zero_tolerance),
            "GRB_LICENSE_FILE": str(settings.gurobi_license_file),
            "PYTHONPATH": str(Path(__file__).resolve().parents[3]),
        }
    )
    command = [
        sys.executable,
        "-m",
        "backend.app.services.runner_entry",
        str(job_dir / "inputs"),
        str(artifact),
    ]
    started = time.monotonic()
    with log_path.open("ab", buffering=0) as log:
        process = subprocess.Popen(  # noqa: S603 - fixed argv, no shell
            command,
            cwd=job_dir / "inputs",
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        on_pid(process.pid)
        while process.poll() is None:
            if cancel_requested():
                _stop_process(process, settings.cancellation_grace_seconds)
                return RunOutcome(
                    RunStatus.cancelled,
                    RunSummary(),
                    None,
                    error_code="cancelled_by_user",
                    error_message="The run was cancelled.",
                    pid=process.pid,
                )
            if time.monotonic() - started > settings.solve_timeout_seconds + 300:
                _stop_process(process, settings.cancellation_grace_seconds)
                return RunOutcome(
                    RunStatus.timed_out,
                    RunSummary(),
                    None,
                    error_code="solver_timeout",
                    error_message=SAFE_ERRORS["solver_timeout"],
                    pid=process.pid,
                )
            time.sleep(0.5)
        log.write(
            (
                "\n[hydrogen-run] "
                + json.dumps(
                    {
                        "event": "subprocess_exited",
                        "return_code": process.returncode,
                    },
                    sort_keys=True,
                )
                + "\n"
            ).encode("utf-8")
        )

    on_processing()
    if not artifact.is_file():
        return RunOutcome(
            RunStatus.failed,
            RunSummary(),
            None,
            "result_missing",
            SAFE_ERRORS["result_missing"],
            process.pid,
        )
    try:
        with gzip.open(artifact, "rt", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return RunOutcome(
            RunStatus.failed,
            RunSummary(),
            None,
            "result_missing",
            SAFE_ERRORS["result_missing"],
            process.pid,
        )
    if payload.get("stage") == "failed":
        error_type = str(payload.get("error_type", ""))
        detail = str(payload.get("error_detail", "")).lower()
        code = (
            "solver_unavailable"
            if "gurobi" in detail or "license" in detail or "licence" in detail
            else "model_build_failed"
        )
        return RunOutcome(
            RunStatus.failed,
            RunSummary(warnings=[f"Internal failure type: {error_type}" if error_type else ""]),
            artifact,
            code,
            SAFE_ERRORS[code],
            process.pid,
        )
    termination = str(payload.get("termination_condition", ""))
    normalized_termination = termination.lower()
    if normalized_termination == "optimal":
        status = RunStatus.completed
        error_code = None
        error_message = None
    elif normalized_termination in {"maxtimelimit", "maxtimelimitwithsolution", "timelimit"}:
        status = RunStatus.timed_out
        error_code = "solver_timeout"
        error_message = SAFE_ERRORS["solver_timeout"]
    elif normalized_termination in {"infeasible", "infeasibleorunbounded"}:
        status = RunStatus.failed
        error_code = f"termination_{normalized_termination}"
        diagnostics = payload.get("iis_diagnostics")
        suffix = (
            " An IIS diagnostic was saved in the local results volume."
            if diagnostics
            else ""
        )
        error_message = "Gurobi proved that the staged model is infeasible." + suffix
    else:
        status = RunStatus.failed
        error_code = f"termination_{normalized_termination or 'unknown'}"
        error_message = "Gurobi did not return an optimal solution. Review the local run log."
    summary = RunSummary(
        solver_status=payload.get("solver_status"),
        termination_condition=termination,
        objective_value=payload.get("objective_value"),
        num_variables=payload.get("num_variables"),
        num_constraints=payload.get("num_constraints"),
        build_seconds=payload.get("build_seconds"),
        solve_seconds=payload.get("solve_seconds"),
        peak_memory_mb=payload.get("peak_memory_mb"),
        warnings=[
            value
            for value in [
                payload.get("load_warning"),
                payload.get("iis_warning"),
            ]
            if value
        ],
    )
    return RunOutcome(status, summary, artifact, error_code, error_message, process.pid)
