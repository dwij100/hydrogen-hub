from __future__ import annotations

import gzip
import json
import subprocess
import sys
from pathlib import Path

from backend.app.config import Settings
from backend.app.schemas import RunStatus
from backend.app.services import model_runner


def test_stop_process_terminates_the_real_process_group():
    process = subprocess.Popen(
        [sys.executable, "-c", "import time; time.sleep(60)"],
        start_new_session=True,
    )
    model_runner._stop_process(process, grace_seconds=1)
    assert process.poll() is not None


def test_solver_time_limit_is_not_reported_as_success(tmp_path: Path, monkeypatch):
    job_dir = tmp_path / "job"
    (job_dir / "inputs").mkdir(parents=True)
    settings = Settings(data_dir=tmp_path / "data", solve_timeout_seconds=10)

    class FinishedProcess:
        pid = 12345
        returncode = 0
        def __init__(self, *args, **kwargs):
            artifact = settings.result_dir / "run-1.json.gz"
            artifact.parent.mkdir(parents=True, exist_ok=True)
            with gzip.open(artifact, "wt", encoding="utf-8") as handle:
                json.dump({
                    "stage": "completed", "solver_status": "ok",
                    "termination_condition": "maxTimeLimit", "objective_value": 2.0,
                }, handle)
        def poll(self): return 0

    monkeypatch.setattr(model_runner.subprocess, "Popen", FinishedProcess)
    outcome = model_runner.execute(
        job_dir=job_dir, settings=settings, run_id="run-1",
        cancel_requested=lambda: False, on_pid=lambda _: None, on_processing=lambda: None,
    )
    assert outcome.status is RunStatus.timed_out
    assert outcome.error_code == "solver_timeout"


def test_infeasible_result_is_specific_and_retains_iis_metadata(tmp_path: Path, monkeypatch):
    job_dir = tmp_path / "job"
    (job_dir / "inputs").mkdir(parents=True)
    settings = Settings(data_dir=tmp_path / "data", solve_timeout_seconds=10)

    class FinishedProcess:
        pid = 23456
        returncode = 0

        def __init__(self, *args, **kwargs):
            artifact = settings.result_dir / "run-iis.json.gz"
            artifact.parent.mkdir(parents=True, exist_ok=True)
            with gzip.open(artifact, "wt", encoding="utf-8") as handle:
                json.dump(
                    {
                        "stage": "completed",
                        "solver_status": "warning",
                        "termination_condition": "infeasible",
                        "objective_value": None,
                        "iis_diagnostics": {
                            "summary_file": "run-iis.iis.json",
                            "model_file": "run-iis.iis.ilp",
                        },
                    },
                    handle,
                )

        def poll(self):
            return 0

    monkeypatch.setattr(model_runner.subprocess, "Popen", FinishedProcess)
    outcome = model_runner.execute(
        job_dir=job_dir,
        settings=settings,
        run_id="run-iis",
        cancel_requested=lambda: False,
        on_pid=lambda _: None,
        on_processing=lambda: None,
    )
    assert outcome.status is RunStatus.failed
    assert outcome.error_code == "termination_infeasible"
    assert "proved" in (outcome.error_message or "")
    assert "IIS diagnostic" in (outcome.error_message or "")
