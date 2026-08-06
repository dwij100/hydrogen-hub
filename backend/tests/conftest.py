from pathlib import Path

import pytest

from backend.app.schemas import ScenarioConfig
from backend.app.services.dataset_loader import load_bundled

SOLVER_DIR = Path(__file__).resolve().parents[1] / "solver"
DATA_DIR = SOLVER_DIR / "data" / "johor118"


@pytest.fixture(scope="session")
def baseline():
    return load_bundled(DATA_DIR)


@pytest.fixture()
def scenario() -> ScenarioConfig:
    return ScenarioConfig.model_validate(
        {
            "dataset_id": "johor118",
            "horizon_hours": 24,
            "infrastructure_ids": ["INF-POM-001", "INF-WWTP-001", "INF-BSP-001"],
            "solar_farm_ids": ["INF-SF-001"],
            "consumers": [
                {"consumer_id": "CON-HC-001", "demand_kg_per_day": 240},
                {"consumer_id": "CON-HC-003", "demand_kg_per_day": 120},
            ],
            "vehicles": {
                "pome_trucks": 1,
                "biogas_trucks": 1,
                "biomass_trucks": 1,
                "bioh2_trucks": 1,
                "gaseous_h2_trailers": 1,
                "bev_fleet": 0,
                "fcev_fleet": 0,
            },
            "railway": {"enabled": True, "station_ids": ["RFS-001"], "train_count": 1},
        }
    )
