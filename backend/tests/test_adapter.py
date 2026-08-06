from __future__ import annotations

import hashlib
from pathlib import Path

import pytest
from pydantic import ValidationError

from backend.app.schemas import Severity
from backend.app.services import input_adapter
from backend.app.services.dataset_loader import CONSUMED_TABLES, sha256_frame, validate_dataset
from backend.tests.conftest import SOLVER_DIR


def test_all_29_release_hashes_match():
    lines = (SOLVER_DIR / "manifest.sha256").read_text().splitlines()
    assert len(lines) == 29
    for line in lines:
        digest, _, relative = line.partition("  ")
        path = SOLVER_DIR / relative.removeprefix("./")
        assert hashlib.sha256(path.read_bytes()).hexdigest() == digest


def test_baseline_validates_and_has_24_hours(baseline):
    assert not [issue for issue in validate_dataset(baseline) if issue.severity is Severity.error]
    assert baseline.counts()["time_periods"] == 24


@pytest.mark.parametrize(
    ("catalog", "solver"),
    [
        ("INF-POM-001", "POM1"), ("INF-WWTP-005", "WWTP5"),
        ("INF-BSP-002", "BSP2"), ("INF-BHH-003", "BHH3"),
        ("INF-SF-001", "SF1"), ("CON-HC-003", "C3"),
        ("RFS-002", "Pasir Gudang Terminal"),
    ],
)
def test_identifier_mapping(catalog, solver):
    assert input_adapter.map_catalog_id(catalog) == solver


def test_unsupported_solar_is_rejected():
    with pytest.raises(input_adapter.MappingError) as error:
        input_adapter.map_catalog_id("INF-SF-003")
    assert error.value.code == "unsupported_solar_farm"


def test_demand_and_templates_are_deterministic(baseline, scenario):
    staged, resolved = input_adapter.adapt(baseline, scenario)
    h2 = staged.frames["h2_johor118"].set_index("Unit")["Demand"].to_dict()
    assert h2["C1"] == 240
    assert h2["C2"] == 0
    assert h2["C3"] == 120
    assert resolved.vehicle_templates["POME"] == ["TK1"]
    assert resolved.vehicle_templates["Biogas"] == ["TK16"]
    assert resolved.vehicle_templates["Biomass"] == ["TK11"]
    assert resolved.trains == ["RW1"]


def test_unsupported_h2_tanks_are_excluded_only_from_staged_runs(baseline, scenario):
    original = baseline.frames["storage_johor118"].copy(deep=True)
    staged, resolved = input_adapter.adapt(baseline, scenario)

    assert set(resolved.excluded_unsupported_storage_units) == {
        "HT1", "HT2", "HT3", "HT4", "HT5"
    }
    assert set(staged.frames["storage_johor118"]["Type"].astype(str)) == {"BESS"}
    assert not set(resolved.excluded_unsupported_storage_units) & set(
        staged.frames["storage_johor118"]["Unit"].astype(str)
    )
    assert baseline.frames["storage_johor118"].equals(original)


def test_active_set_closure_and_matrices(baseline, scenario):
    staged, resolved = input_adapter.adapt(baseline, scenario)
    assert "POM1" in resolved.active_facilities
    assert "DC" in resolved.active_facilities
    assert "Johor Bahru" in resolved.active_facilities
    facilities = staged.frames["facilities_johor118"]["Facility"].astype(str).tolist()
    for table in ("path_johor118", "distances_johor118"):
        assert list(staged.frames[table].index) == facilities
        assert list(staged.frames[table].columns) == facilities
    assert not [issue for issue in validate_dataset(staged) if issue.severity is Severity.error]


def test_staging_is_isolated_atomic_and_manifested(tmp_path: Path, baseline, scenario):
    original = {name: sha256_frame(baseline.frames[name]) for name in CONSUMED_TABLES}
    staged, resolved = input_adapter.adapt(baseline, scenario)
    (tmp_path / "inputs").mkdir()
    (tmp_path / "inputs" / ".facilities_johor118.csv.abandoned").write_text("partial")
    manifest = input_adapter.stage_run(
        baseline,
        staged,
        scenario,
        resolved,
        run_id="test-run",
        run_dir=tmp_path,
        solver_module=SOLVER_DIR / "HSC_operational.py",
        baseline_manifest=SOLVER_DIR / "manifest.sha256",
    )
    assert (tmp_path / "input-manifest.json").is_file()
    assert (tmp_path / "submitted-scenario.json").is_file()
    assert len(manifest.generated_files) == len(CONSUMED_TABLES) + 1
    assert not (tmp_path / "inputs" / "cplex.py").exists()
    assert not (tmp_path / "inputs" / ".facilities_johor118.csv.abandoned").exists()
    assert all(sha256_frame(baseline.frames[name]) == digest for name, digest in original.items())


def test_invalid_values_are_rejected(scenario):
    data = scenario.model_dump()
    data["horizon_hours"] = 48
    with pytest.raises(ValidationError):
        type(scenario).model_validate(data)
    data = scenario.model_dump()
    data["consumers"][0]["demand_kg_per_day"] = -1
    with pytest.raises(ValidationError):
        type(scenario).model_validate(data)


def test_empty_vehicle_selection_is_rejected(scenario):
    data = scenario.model_dump()
    data["vehicles"] = {key: 0 for key in data["vehicles"]}
    with pytest.raises(ValidationError):
        type(scenario).model_validate(data)
