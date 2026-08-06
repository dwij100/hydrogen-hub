import gzip
import json
from pathlib import Path

from backend.app.api.solver_routes import get_store
from backend.app.config import Settings
from backend.app.database import RunStore
from backend.app.main import app
from backend.app.schemas import RunRequest, RunStatus
from fastapi.testclient import TestClient


def test_openapi_contains_the_single_versioned_contract():
    paths = set(app.openapi()["paths"])
    required = {
        "/healthz", "/api/v1/validate", "/api/v1/runs",
        "/api/v1/runs/{run_id}", "/api/v1/runs/{run_id}/cancel",
        "/api/v1/runs/{run_id}/results",
    }
    assert required <= paths
    assert not any(path.startswith("/api/solver") for path in paths)


def test_frontend_run_states_match_backend_enum():
    source = (Path(__file__).resolve().parents[2] / "src/lib/solver/types.ts").read_text()
    for status in RunStatus:
        assert f"'{status.value}'" in source


def test_invalid_request_returns_safe_field_level_issues():
    response = TestClient(app).post("/api/v1/validate", json={"scenario": {}})
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["code"] == "request_validation_error"
    assert detail["issues"]
    assert "input" not in detail["issues"][0]


def test_actual_validation_endpoint_runs_the_adapter(scenario):
    response = TestClient(app).post(
        "/api/v1/validate", json={"scenario": scenario.model_dump(mode="json")}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["valid"] is True
    assert body["resolved_configuration"]["plants"] == ["POM1", "WWTP1", "BSP1"]
    assert body["resolved_configuration"]["consumer_daily_demand_kg"] == {
        "C1": 240.0,
        "C3": 120.0,
    }
    assert body["manifest_preview"]["solver_sha256"]


def test_completed_results_survive_store_recreation(tmp_path, scenario):
    settings = Settings(data_dir=tmp_path)
    store = RunStore(settings)
    row, _ = store.create_or_get(
        RunRequest(input_hash="hash-1", idempotency_key="12345678", scenario=scenario)
    )
    artifact = settings.result_dir / f"{row['id']}.json.gz"
    artifact.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(artifact, "wt", encoding="utf-8") as handle:
        json.dump({"results": {"families": {}}, "sets": {}}, handle)
    store.update(
        row["id"],
        status=RunStatus.completed.value,
        progress=100,
        result_artifact=str(artifact),
        summary_json=json.dumps(
            {"termination_condition": "optimal", "objective_value": 0.0, "solve_seconds": 1.5}
        ),
    )
    # A new RunStore instance is the same boundary crossed by an API restart.
    restarted = RunStore(settings)
    app.dependency_overrides[get_store] = lambda: restarted
    try:
        response = TestClient(app).get(f"/api/v1/runs/{row['id']}/results")
    finally:
        app.dependency_overrides.pop(get_store, None)
    assert response.status_code == 200
    assert response.json()["objective_value"] == 0.0
    assert response.json()["charts"][0]["key"] == "submitted-hydrogen-demand"
