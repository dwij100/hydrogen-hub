"""Local desktop runtime configuration. No cloud database or browser secret is required."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel, ConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseModel):
    model_config = ConfigDict(extra="ignore")

    app_version: str = "1.2.0"
    local_single_user_mode: bool = True
    allowed_origins: str = "http://localhost:8080"
    solver_dir: Path = REPO_ROOT / "backend" / "solver"
    # Docker Compose overrides this with /data.  A repository-local default keeps
    # imports, tests, and OpenAPI generation writable outside the container.
    data_dir: Path = REPO_ROOT / ".runtime-data"
    solver_name: str = "gurobi"
    gurobi_license_file: Path = Path("/run/secrets/gurobi.lic")
    solve_timeout_seconds: int = 6 * 60 * 60
    cancellation_grace_seconds: int = 15
    worker_poll_seconds: float = 1.0
    worker_stale_seconds: int = 20
    zero_tolerance: float = 1e-9
    raw_result_page_size: int = 2500
    keep_run_inputs: bool = True

    @property
    def cors_origins(self) -> list[str]:
        return [item.strip() for item in self.allowed_origins.split(",") if item.strip()]

    @property
    def dataset_root(self) -> Path:
        return self.solver_dir / "data"

    @property
    def dataset_dir(self) -> Path:
        return self.dataset_root / "johor118"

    @property
    def solver_module_path(self) -> Path:
        return self.solver_dir / "HSC_operational.py"

    @property
    def baseline_manifest_path(self) -> Path:
        return self.solver_dir / "manifest.sha256"

    @property
    def database_path(self) -> Path:
        return self.data_dir / "hydrogen-hub.sqlite3"

    @property
    def runs_dir(self) -> Path:
        return self.data_dir / "runs"

    @property
    def result_dir(self) -> Path:
        return self.data_dir / "results"

    @property
    def log_dir(self) -> Path:
        return self.data_dir / "logs"


@lru_cache
def get_settings() -> Settings:
    defaults = Settings()
    values: dict[str, object] = {}
    for name, field in type(defaults).model_fields.items():
        raw = os.getenv(name.upper())
        if raw is None:
            continue
        annotation = field.annotation
        if annotation is bool:
            values[name] = raw.strip().lower() in {"1", "true", "yes", "on"}
        elif annotation is int:
            values[name] = int(raw)
        elif annotation is float:
            values[name] = float(raw)
        elif annotation is Path:
            values[name] = Path(raw)
        else:
            values[name] = raw
    return Settings(**values)
