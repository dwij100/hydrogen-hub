"""Translate the restricted UI scenario into isolated inputs for the unchanged model."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

from ..schemas import (
    GeneratedFileManifest,
    InputManifest,
    ScenarioConfig,
    TableManifest,
)
from .dataset_loader import CONSUMED_TABLES, TABLE_SPECS, Dataset, sha256_bytes, sha256_frame

ADAPTER_VERSION = "1.2.0"
CONSUMER_MAP = {
    "CON-HC-001": "C1",
    "CON-HC-002": "C2",
    "CON-HC-003": "C3",
}
STATION_MAP = {
    "RFS-001": "Segamat Inland Port",
    "RFS-002": "Pasir Gudang Terminal",
}
VEHICLE_FIELD_TO_TYPE = {
    "pome_trucks": "POME",
    "biogas_trucks": "Biogas",
    "biomass_trucks": "Biomass",
    "bioh2_trucks": "BioH2",
    "gaseous_h2_trailers": "99H2",
    "bev_fleet": "BEV",
    "fcev_fleet": "FCEV",
}
_PREFIX_MAP = (
    ("INF-POM-", "POM"),
    ("INF-WWTP-", "WWTP"),
    ("INF-BSP-", "BSP"),
    ("INF-BHH-", "BHH"),
    ("INF-SF-", "SF"),
)


class MappingError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class ResolvedScenario:
    plants: list[str]
    solar_farms: list[str]
    consumers: dict[str, float]
    vehicles: list[str]
    vehicle_templates: dict[str, list[str]]
    trains: list[str]
    stations: list[str]
    staged_storage_units: list[str]
    excluded_unsupported_storage_units: list[str]
    active_facilities: list[str]

    def as_dict(self) -> dict[str, Any]:
        return {
            "plants": self.plants,
            "solar_farms": self.solar_farms,
            "consumer_daily_demand_kg": self.consumers,
            "vehicles": self.vehicles,
            "vehicle_templates_by_type": self.vehicle_templates,
            "trains": self.trains,
            "stations": self.stations,
            "staged_storage_units": self.staged_storage_units,
            "excluded_unsupported_storage_units": self.excluded_unsupported_storage_units,
            "active_facilities": self.active_facilities,
        }


def map_catalog_id(catalog_id: str) -> str:
    key = catalog_id.strip()
    if key in CONSUMER_MAP:
        return CONSUMER_MAP[key]
    if key in STATION_MAP:
        return STATION_MAP[key]
    if key in {"INF-SF-003", "INF-SF-004"}:
        raise MappingError(
            "unsupported_solar_farm",
            f"{key} has no profile in the bundled solver data.",
        )
    for prefix, solver_prefix in _PREFIX_MAP:
        if key.startswith(prefix):
            suffix = key[len(prefix) :]
            if re.fullmatch(r"\d+", suffix):
                return f"{solver_prefix}{int(suffix)}"
    raise MappingError("unsupported_identifier", f"'{catalog_id}' is not supported.")


def _natural_key(value: str) -> tuple[str, int]:
    match = re.fullmatch(r"(\D+)(\d+)", value)
    return (match.group(1), int(match.group(2))) if match else (value, 0)


def filter_wide_table(name: str, df: pd.DataFrame, masks: dict[str, pd.Series]) -> pd.DataFrame:
    """Filter each independent logical group without corrupting padded neighbours."""
    spec = TABLE_SPECS[name]
    pieces: list[pd.DataFrame] = []
    for group, columns in spec.logical_groups.items():
        present = [column for column in columns if column in df.columns]
        if not present:
            continue
        block = df[present]
        mask = masks.get(group)
        if mask is not None:
            block = block[mask.reindex(block.index, fill_value=False)]
        pieces.append(block.dropna(how="all").reset_index(drop=True))
    classified = {column for columns in spec.logical_groups.values() for column in columns}
    leftovers = [column for column in df.columns if column not in classified]
    if leftovers:
        pieces.append(df[leftovers].reset_index(drop=True))
    height = max((len(piece) for piece in pieces), default=0)
    combined = pd.concat([piece.reindex(range(height)) for piece in pieces], axis=1)
    return combined[[column for column in df.columns if column in combined.columns]]


def _select_vehicle_templates(dataset: Dataset, scenario: ScenarioConfig) -> dict[str, list[str]]:
    vehicles = dataset.frames["vehicles_johor118"]
    rows = vehicles[["Vehicle", "Vehicle Type"]].dropna(subset=["Vehicle", "Vehicle Type"])
    selected: dict[str, list[str]] = {}
    quantities = scenario.vehicles.model_dump()
    for field, vehicle_type in VEHICLE_FIELD_TO_TYPE.items():
        available = sorted(
            rows.loc[rows["Vehicle Type"].astype(str) == vehicle_type, "Vehicle"]
            .astype(str)
            .tolist(),
            key=_natural_key,
        )
        count = int(quantities[field])
        if count > len(available):
            raise MappingError(
                "vehicle_quantity_exceeds_templates",
                f"{field} requests {count}, but only {len(available)} templates are available.",
            )
        selected[vehicle_type] = available[:count]
    return selected


def resolve_scenario(dataset: Dataset, scenario: ScenarioConfig) -> ResolvedScenario:
    frames = dataset.frames
    all_facilities = frames["facilities_johor118"]["Facility"].dropna().astype(str).tolist()
    facility_set = set(all_facilities)
    all_plants = set(frames["plants_johor118"]["Plant"].dropna().astype(str))
    all_solar = set(frames["solar_johor118"]["Solar Farms"].dropna().astype(str))

    plants = [map_catalog_id(value) for value in scenario.infrastructure_ids]
    unknown_plants = sorted(set(plants) - all_plants)
    if unknown_plants:
        raise MappingError(
            "unknown_infrastructure",
            f"The bundled model does not contain: {', '.join(unknown_plants)}.",
        )
    solar = [map_catalog_id(value) for value in scenario.solar_farm_ids]
    unknown_solar = sorted(set(solar) - all_solar)
    if unknown_solar:
        raise MappingError("unknown_solar_farm", f"Unknown solar farm: {unknown_solar[0]}.")

    consumers = {
        map_catalog_id(item.consumer_id): float(item.demand_kg_per_day)
        for item in scenario.consumers
    }
    vehicle_templates = _select_vehicle_templates(dataset, scenario)
    vehicles = [vehicle for group in vehicle_templates.values() for vehicle in group]
    if not vehicles:
        raise MappingError("empty_vehicle_selection", "At least one vehicle is required.")

    train_count = scenario.railway.train_count if scenario.railway.enabled else 0
    all_trains = sorted(
        frames["rw_johor118"]["Trains"].dropna().astype(str).tolist(), key=_natural_key
    )
    trains = all_trains[:train_count]
    stations = [map_catalog_id(value) for value in scenario.railway.station_ids]

    # Version 1 has no user-facing H2-storage control.  The five baseline H2
    # tanks cannot be carried into arbitrary reduced scenarios: the preserved
    # model fixes their first and last SOC at 30% while applying hourly leakage,
    # which requires an external H2 replenishment path that a reduced scenario
    # may not contain.  Keep the baseline electrical storage (part of the fixed
    # power-system data), but explicitly exclude the unsupported H2 tanks from
    # every staged run.  The immutable source CSV remains unchanged.
    storage = frames["storage_johor118"]
    storage_type = storage["Type"].astype(str)
    staged_storage_units = (
        storage.loc[storage_type != "H2", "Unit"].dropna().astype(str).tolist()
    )
    excluded_storage_units = (
        storage.loc[storage_type == "H2", "Unit"].dropna().astype(str).tolist()
    )

    active: set[str] = set(plants) | set(solar) | set(stations)
    # H2 nodes are retained because the unchanged balance block indexes all of them.
    active.update(frames["h2_johor118"]["Unit"].dropna().astype(str))
    # Storage links and vehicle dependencies must remain available to model Params.
    staged_storage = storage[storage["Unit"].astype(str).isin(staged_storage_units)]
    active.update(
        value
        for value in staged_storage["Stor Bus"].dropna().astype(str)
        if value in facility_set
    )
    vehicle_rows = frames["vehicles_johor118"]
    chosen_rows = vehicle_rows[vehicle_rows["Vehicle"].astype(str).isin(vehicles)]
    active.update(chosen_rows["Initial Loc"].dropna().astype(str))
    active.update(vehicle_rows["Location"].dropna().astype(str))
    active.update(vehicle_rows["Shift LOC"].dropna().astype(str))
    active_facilities = [value for value in all_facilities if value in active]

    return ResolvedScenario(
        plants=plants,
        solar_farms=solar,
        consumers=consumers,
        vehicles=vehicles,
        vehicle_templates=vehicle_templates,
        trains=trains,
        stations=stations,
        staged_storage_units=staged_storage_units,
        excluded_unsupported_storage_units=excluded_storage_units,
        active_facilities=active_facilities,
    )


def adapt(dataset: Dataset, scenario: ScenarioConfig) -> tuple[Dataset, ResolvedScenario]:
    resolved = resolve_scenario(dataset, scenario)
    frames = {name: frame.copy(deep=True) for name, frame in dataset.frames.items()}
    active = set(resolved.active_facilities)

    facilities = frames["facilities_johor118"]
    frames["facilities_johor118"] = facilities[
        facilities["Facility"].astype(str).isin(active)
    ].reset_index(drop=True)

    plants = frames["plants_johor118"]
    selected_plants = set(resolved.plants)
    frames["plants_johor118"] = filter_wide_table(
        "plants_johor118",
        plants,
        {
            "plant": plants["Plant"].astype(str).isin(selected_plants),
            "plant_process": plants["Plant Index"].astype(str).isin(selected_plants),
            "inventory": plants["Plant Mat Index"].astype(str).isin(selected_plants),
        },
    )

    # The original model accepts one aggregate 24-hour demand per H2 node.
    h2 = frames["h2_johor118"].copy()
    h2.loc[h2["Unit"].astype(str).isin(CONSUMER_MAP.values()), "Demand"] = 0.0
    for consumer, demand in resolved.consumers.items():
        h2.loc[h2["Unit"].astype(str) == consumer, "Demand"] = demand
    frames["h2_johor118"] = h2

    storage = frames["storage_johor118"]
    frames["storage_johor118"] = storage[
        storage["Unit"].astype(str).isin(resolved.staged_storage_units)
    ].reset_index(drop=True)

    solar = frames["solar_johor118"]
    selected_solar = set(resolved.solar_farms)
    frames["solar_johor118"] = filter_wide_table(
        "solar_johor118",
        solar,
        {
            "farms": solar["Solar Farms"].astype(str).isin(selected_solar),
            "site_power": solar["SF Index"].astype(str).isin(selected_solar),
        },
    )

    vehicles = frames["vehicles_johor118"]
    selected_vehicles = set(resolved.vehicles)
    frames["vehicles_johor118"] = filter_wide_table(
        "vehicles_johor118",
        vehicles,
        {"vehicles": vehicles["Vehicle"].astype(str).isin(selected_vehicles)},
    )

    rail = frames["rw_johor118"]
    selected_trains = set(resolved.trains)
    selected_stations = set(resolved.stations)
    frames["rw_johor118"] = filter_wide_table(
        "rw_johor118",
        rail,
        {
            "trains": rail["Trains"].astype(str).isin(selected_trains),
            "stations": rail["Stations"].astype(str).isin(selected_stations),
            "paths": rail["RW Index"].astype(str).isin(selected_trains),
            "geo": rail["Rail Freight Stations"].astype(str).isin(selected_stations),
        },
    )

    for table in ("path_johor118", "distances_johor118"):
        labels = [label for label in resolved.active_facilities if label in frames[table].index]
        frames[table] = frames[table].loc[labels, labels]
    pipe_nodes = [
        str(value)
        for value in frames["h2_johor118"]["Unit"].dropna()
        if str(value) in frames["pipes_johor118"].index
    ]
    frames["pipes_johor118"] = frames["pipes_johor118"].loc[pipe_nodes, pipe_nodes]
    return Dataset(frames), resolved


def _table_manifests(dataset: Dataset) -> list[TableManifest]:
    return [
        TableManifest(
            name=name,
            rows=len(dataset.frames[name]),
            columns=[str(column) for column in dataset.frames[name].columns],
            sha256=sha256_frame(dataset.frames[name]),
        )
        for name in sorted(dataset.frames)
    ]


def build_manifest(
    baseline: Dataset,
    staged: Dataset,
    scenario: ScenarioConfig,
    resolved: ResolvedScenario,
    *,
    solver_module: Path,
    baseline_manifest: Path,
    run_id: str | None = None,
    generated_files: list[GeneratedFileManifest] | None = None,
) -> InputManifest:
    body = {
        "manifest_version": "1",
        "adapter_version": ADAPTER_VERSION,
        "run_id": run_id,
        "dataset_id": "johor118",
        "horizon_hours": 24,
        "solver_sha256": sha256_bytes(solver_module.read_bytes()),
        "baseline_manifest_sha256": sha256_bytes(baseline_manifest.read_bytes()),
        "original_tables": [item.model_dump() for item in _table_manifests(baseline)],
        "staged_tables": [item.model_dump() for item in _table_manifests(staged)],
        "submitted_scenario": scenario.model_dump(mode="json"),
        "resolved_configuration": resolved.as_dict(),
        "active_facilities": resolved.active_facilities,
    }
    digest = sha256_bytes(
        json.dumps(body, sort_keys=True, separators=(",", ":")).encode("utf-8")
    )
    return InputManifest(
        **body,
        created_at=datetime.now(timezone.utc),
        generated_files=generated_files or [],
        manifest_sha256=digest,
    )


def _atomic_write(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    except Exception:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass
        raise


def stage_run(
    baseline: Dataset,
    staged: Dataset,
    scenario: ScenarioConfig,
    resolved: ResolvedScenario,
    *,
    run_id: str,
    run_dir: Path,
    solver_module: Path,
    baseline_manifest: Path,
) -> InputManifest:
    """Atomically write a complete isolated per-run input and solver copy."""
    inputs_dir = run_dir / "inputs"
    inputs_dir.mkdir(parents=True, exist_ok=True)
    # A hard container stop can interrupt os.replace after mkstemp. These files
    # are scoped to this run directory and never contain baseline originals.
    for abandoned in inputs_dir.glob(".*"):
        if abandoned.is_file():
            abandoned.unlink()
    generated: list[GeneratedFileManifest] = []
    for name in CONSUMED_TABLES:
        spec = TABLE_SPECS[name]
        payload = staged.frames[name].to_csv(
            index=spec.is_matrix, lineterminator="\n"
        ).encode("utf-8")
        destination = inputs_dir / f"{name}.csv"
        _atomic_write(destination, payload)
        generated.append(
            GeneratedFileManifest(
                relative_path=str(destination.relative_to(run_dir)).replace("\\", "/"),
                sha256=sha256_bytes(payload),
                bytes=len(payload),
            )
        )
    solver_destination = inputs_dir / solver_module.name
    shutil.copyfile(solver_module, solver_destination)
    generated.append(
        GeneratedFileManifest(
            relative_path=str(solver_destination.relative_to(run_dir)).replace("\\", "/"),
            sha256=sha256_bytes(solver_destination.read_bytes()),
            bytes=solver_destination.stat().st_size,
        )
    )
    _atomic_write(
        run_dir / "submitted-scenario.json",
        json.dumps(scenario.model_dump(mode="json"), indent=2, sort_keys=True).encode("utf-8"),
    )
    _atomic_write(
        run_dir / "resolved-configuration.json",
        json.dumps(resolved.as_dict(), indent=2, sort_keys=True).encode("utf-8"),
    )
    manifest = build_manifest(
        baseline,
        staged,
        scenario,
        resolved,
        solver_module=solver_module,
        baseline_manifest=baseline_manifest,
        run_id=run_id,
        generated_files=generated,
    )
    _atomic_write(
        run_dir / "input-manifest.json",
        manifest.model_dump_json(indent=2).encode("utf-8"),
    )
    return manifest
