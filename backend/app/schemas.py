"""Versioned API schemas shared through the generated OpenAPI document."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class RunStatus(str, Enum):
    queued = "queued"
    preparing = "preparing"
    validating = "validating"
    solving = "solving"
    processing_results = "processing_results"
    completed = "completed"
    failed = "failed"
    cancelling = "cancelling"
    cancelled = "cancelled"
    timed_out = "timed_out"


TERMINAL_STATUSES = {
    RunStatus.completed,
    RunStatus.failed,
    RunStatus.cancelled,
    RunStatus.timed_out,
}
CANCELLABLE_STATUSES = {
    RunStatus.queued,
    RunStatus.preparing,
    RunStatus.validating,
    RunStatus.solving,
    RunStatus.processing_results,
    RunStatus.cancelling,
}


class Severity(str, Enum):
    error = "error"
    warning = "warning"


class ValidationIssue(StrictModel):
    severity: Severity
    code: str
    sheet: str | None = Field(default=None, serialization_alias="table")
    column: str | None = Field(default=None, serialization_alias="field")
    row: int | None = None
    value: str | None = None
    expected: str | None = None
    message: str


class ConsumerDemand(StrictModel):
    consumer_id: Literal["CON-HC-001", "CON-HC-002", "CON-HC-003"]
    demand_kg_per_day: float = Field(ge=0, le=10_000_000)


class VehicleQuantities(StrictModel):
    pome_trucks: int = Field(default=0, ge=0, le=5)
    biogas_trucks: int = Field(default=0, ge=0, le=5)
    biomass_trucks: int = Field(default=0, ge=0, le=5)
    bioh2_trucks: int = Field(default=0, ge=0, le=5)
    gaseous_h2_trailers: int = Field(default=0, ge=0, le=5)
    bev_fleet: int = Field(default=0, ge=0, le=30)
    fcev_fleet: int = Field(default=0, ge=0, le=20)

    def total(self) -> int:
        return sum(int(v) for v in self.model_dump().values())


class RailwaySelection(StrictModel):
    enabled: bool = False
    station_ids: list[Literal["RFS-001", "RFS-002"]] = Field(default_factory=list)
    train_count: int = Field(default=0, ge=0, le=3)

    @model_validator(mode="after")
    def consistent(self) -> "RailwaySelection":
        if self.enabled and (not self.station_ids or self.train_count < 1):
            raise ValueError("Railway transport requires at least one station and one train.")
        if not self.enabled and (self.station_ids or self.train_count):
            raise ValueError("Railway stations and trains must be empty when railway is disabled.")
        if len(set(self.station_ids)) != len(self.station_ids):
            raise ValueError("Railway station identifiers must be unique.")
        return self


class ScenarioConfig(StrictModel):
    """Only controls that the preserved Johor model can consume."""

    dataset_id: Literal["johor118"] = "johor118"
    horizon_hours: Literal[24] = 24
    infrastructure_ids: list[str] = Field(min_length=1)
    solar_farm_ids: list[Literal["INF-SF-001", "INF-SF-002"]] = Field(
        default_factory=list
    )
    consumers: list[ConsumerDemand] = Field(min_length=1, max_length=3)
    vehicles: VehicleQuantities
    railway: RailwaySelection = Field(default_factory=RailwaySelection)

    @field_validator("infrastructure_ids")
    @classmethod
    def supported_infrastructure(cls, values: list[str]) -> list[str]:
        allowed = ("INF-POM-", "INF-WWTP-", "INF-BSP-", "INF-BHH-")
        cleaned = [value.strip() for value in values]
        if len(set(cleaned)) != len(cleaned):
            raise ValueError("Infrastructure identifiers must be unique.")
        if any(not value.startswith(allowed) for value in cleaned):
            raise ValueError("Only POM, WWTP, BSP and BHH infrastructure is supported.")
        return cleaned

    @model_validator(mode="after")
    def non_empty_and_unique(self) -> "ScenarioConfig":
        ids = [item.consumer_id for item in self.consumers]
        if len(ids) != len(set(ids)):
            raise ValueError("Each consumer may be selected only once.")
        if self.vehicles.total() < 1:
            raise ValueError("At least one supported vehicle template is required.")
        if len(set(self.solar_farm_ids)) != len(self.solar_farm_ids):
            raise ValueError("Solar farm identifiers must be unique.")
        return self


class ValidateRequest(StrictModel):
    scenario: ScenarioConfig


class TableManifest(StrictModel):
    name: str
    rows: int
    columns: list[str]
    sha256: str


class GeneratedFileManifest(StrictModel):
    relative_path: str
    sha256: str
    bytes: int


class InputManifest(StrictModel):
    manifest_version: Literal["1"] = "1"
    adapter_version: str
    run_id: str | None = None
    dataset_id: Literal["johor118"] = "johor118"
    horizon_hours: Literal[24] = 24
    created_at: datetime
    solver_sha256: str
    baseline_manifest_sha256: str
    original_tables: list[TableManifest]
    staged_tables: list[TableManifest]
    generated_files: list[GeneratedFileManifest] = Field(default_factory=list)
    submitted_scenario: dict[str, Any]
    resolved_configuration: dict[str, Any]
    active_facilities: list[str]
    manifest_sha256: str


class DatasetSummary(StrictModel):
    id: Literal["johor118"] = "johor118"
    name: str = "Johor 118 (bundled)"
    source: Literal["bundled"] = "bundled"
    tables: list[dict[str, Any]] = Field(default_factory=list)


class ValidateResponse(StrictModel):
    valid: bool
    issues: list[ValidationIssue] = Field(default_factory=list)
    dataset: DatasetSummary | None = None
    resolved_configuration: dict[str, Any] | None = None
    manifest_preview: InputManifest | None = None


class RunRequest(StrictModel):
    project_id: str | None = None
    project_name: str | None = None
    input_hash: str = Field(min_length=1, max_length=256)
    idempotency_key: str = Field(min_length=8, max_length=256)
    scenario: ScenarioConfig


class RunAccepted(StrictModel):
    run_id: str
    status: RunStatus
    duplicate: bool = False


class RunSummary(StrictModel):
    solver_name: str = "gurobi"
    solver_status: str | None = None
    termination_condition: str | None = None
    objective_label: str = "Total hydrogen imbalance"
    objective_unit: str = "model hydrogen units"
    objective_value: float | None = None
    num_variables: int | None = None
    num_constraints: int | None = None
    build_seconds: float | None = None
    solve_seconds: float | None = None
    peak_memory_mb: float | None = None
    warnings: list[str] = Field(default_factory=list)


class RunStatusResponse(StrictModel):
    run_id: str
    project_id: str | None = None
    status: RunStatus
    progress: int = Field(ge=0, le=100)
    message: str | None = None
    error: str | None = None
    error_code: str | None = None
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
    dataset: DatasetSummary
    input_hash: str
    solver_name: str = "gurobi"
    termination_condition: str | None = None
    objective_value: float | None = None
    objective_label: str = "Total hydrogen imbalance"
    solve_seconds: float | None = None
    cancellable: bool = False


class ResultSeriesPoint(StrictModel):
    t: int | str
    value: float


class ResultSeries(StrictModel):
    key: str
    label: str
    unit: str
    points: list[ResultSeriesPoint]


class ResultChartGroup(StrictModel):
    key: str
    label: str
    category: Literal["production", "flows", "utilization", "storage", "transport"]
    xLabel: str
    unit: str
    series: list[ResultSeries]
    chartType: Literal["line", "step", "bar"] = "line"
    yAxisMode: Literal["auto", "fraction", "binary"] = "auto"
    description: str | None = None


class ResultTable(StrictModel):
    key: str
    label: str
    columns: list[str]
    rows: list[list[str | int | float | bool | None]]
    total_rows: int
    page: int = 1
    page_size: int
    truncated: bool = False


class ResultsResponse(StrictModel):
    run_id: str
    status: Literal["completed"] = "completed"
    solver_name: str
    termination_condition: str
    objective_value: float
    objective_label: str
    objective_unit: str
    solve_seconds: float | None = None
    dataset: DatasetSummary
    input_summary: dict[str, str | int | float | bool | None]
    charts: list[ResultChartGroup]
    tables: list[ResultTable]


class SolverReadiness(StrictModel):
    name: Literal["gurobi"] = "gurobi"
    package_status: Literal["available", "unavailable"]
    licence_status: Literal[
        "missing", "invalid", "restricted", "full", "invocation_failed", "unchecked"
    ]
    ready: bool
    message: str


class ComponentHealth(StrictModel):
    ready: bool
    message: str


class QueueHealth(StrictModel):
    queued: int
    active: int


class HealthResponse(StrictModel):
    status: Literal["ok", "degraded"]
    version: str
    api: ComponentHealth
    database: ComponentHealth
    worker: ComponentHealth
    storage: ComponentHealth
    queue: QueueHealth
    solver: SolverReadiness
    dataset: ComponentHealth
