from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

from backend.app.services import input_adapter
from backend.app.services.runner_entry import _load_solver
from backend.app.services.smoke_test import _scenario as licensed_smoke_scenario
from backend.tests.conftest import SOLVER_DIR

pytest.importorskip("pyomo.environ", reason="Pyomo is installed in the production image")


def _assert_adapted_inputs_build(tmp_path: Path, baseline, scenario) -> None:
    staged, resolved = input_adapter.adapt(baseline, scenario)
    input_adapter.stage_run(
        baseline, staged, scenario, resolved, run_id="build", run_dir=tmp_path,
        solver_module=SOLVER_DIR / "HSC_operational.py",
        baseline_manifest=SOLVER_DIR / "manifest.sha256",
    )
    script = (
        "import importlib.util;"
        "s=importlib.util.spec_from_file_location('hsc','HSC_operational.py');"
        "m=importlib.util.module_from_spec(s);s.loader.exec_module(m);"
        "model=m.build_model();print(model.nvariables(),model.nconstraints())"
    )
    result = subprocess.run(
        [sys.executable, "-c", script], cwd=tmp_path / "inputs",
        env={**os.environ, "MPLBACKEND": "Agg"}, capture_output=True, text=True, check=False,
    )
    assert result.returncode == 0, result.stderr[-3000:]
    variables, constraints = [int(value) for value in result.stdout.split()[-2:]]
    assert variables > 2000 and constraints > 2000


def test_adapted_inputs_build_the_solver_model(tmp_path: Path, baseline, scenario):
    _assert_adapted_inputs_build(tmp_path, baseline, scenario)


def test_exact_licensed_smoke_scenario_builds_the_solver_model(
    tmp_path: Path, baseline
):
    _assert_adapted_inputs_build(tmp_path, baseline, licensed_smoke_scenario())


def test_runner_loader_builds_exact_smoke_stage(tmp_path: Path, baseline, monkeypatch):
    staged, resolved = input_adapter.adapt(baseline, licensed_smoke_scenario())
    input_adapter.stage_run(
        baseline, staged, licensed_smoke_scenario(), resolved,
        run_id="runner-load", run_dir=tmp_path,
        solver_module=SOLVER_DIR / "HSC_operational.py",
        baseline_manifest=SOLVER_DIR / "manifest.sha256",
    )
    monkeypatch.chdir(tmp_path / "inputs")
    module = _load_solver(tmp_path / "inputs")
    model = module.build_model()
    assert model.nvariables() > 2000
    assert model.nconstraints() > 2000
