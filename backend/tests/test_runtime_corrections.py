from __future__ import annotations

from pathlib import Path

from backend.app.services.input_adapter import adapt, stage_run
from backend.app.services.smoke_test import _scenario
from backend.tests.conftest import SOLVER_DIR


def test_solver_removes_disconnected_maximum_demand_subsystem():
    source = (SOLVER_DIR / "HSC_operational.py").read_text(encoding="utf-8")
    for token in (
        "maxdemand_block", "model.maxd", "model.M =", "model.X_T",
        "model.md_val", "model.e_mdbill", "model.e_totalbill",
    ):
        assert token not in source


def test_solver_removes_unused_integer_and_idle_variables():
    source = (SOLVER_DIR / "HSC_operational.py").read_text(encoding="utf-8")
    assert "model.counton_gen" not in source
    assert "model.countoff_gen" not in source
    assert "model.idle" not in source
    assert "from cplex import" not in source


def test_staged_run_uses_solver_directly_without_cplex_shim(tmp_path: Path, baseline):
    scenario = _scenario()
    staged, resolved = adapt(baseline, scenario)
    stage_run(
        baseline, staged, scenario, resolved, run_id="simplified", run_dir=tmp_path,
        solver_module=SOLVER_DIR / "HSC_operational.py",
        baseline_manifest=SOLVER_DIR / "manifest.sha256",
    )
    inputs = tmp_path / "inputs"
    assert (inputs / "HSC_operational.py").is_file()
    assert not (inputs / "cplex.py").exists()
