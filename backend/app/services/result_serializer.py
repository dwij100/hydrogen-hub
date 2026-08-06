"""Serialize solved Pyomo variables with stable identifiers, dimensions, and units."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class VariableMeta:
    family: str
    title: str
    unit: str
    index_names: tuple[str, ...]
    sign: str = "Values are non-negative."


def _m(family: str, title: str, unit: str, *indexes: str, sign: str = "Values are non-negative.") -> VariableMeta:
    return VariableMeta(family, title, unit, indexes, sign)


VARIABLE_METADATA: dict[str, VariableMeta] = {
    "plant_inven": _m("plants", "Plant material inventory", "model mass units", "plant", "material", "hour"),
    "process_res": _m("plants", "Plant processing rate", "model input-flow units/hour", "plant", "process", "hour"),
    "h2_inven": _m("hydrogen", "Hydrogen inventory", "kg H2", "node", "hour"),
    "h2_balance": _m("hydrogen", "Hydrogen imbalance", "kg H2", "node"),
    "pipe_in": _m("hydrogen", "Pipeline inflow", "kg H2/hour", "from_node", "to_node", "hour"),
    "pipe_out": _m("hydrogen", "Pipeline outflow", "kg H2/hour", "from_node", "to_node", "hour"),
    "pipe_stor": _m("hydrogen", "Pipeline inventory", "kg H2", "from_node", "to_node", "hour"),
    "H2_charge": _m("hydrogen", "System hydrogen charging", "kg H2/hour", "hour"),
    "H2_discharge": _m("hydrogen", "System hydrogen discharging", "kg H2/hour", "hour"),
    "H2_transit": _m("hydrogen", "Hydrogen in transit", "kg H2", "hour"),
    "gen_elec": _m("electricity", "Electrical generation", "model electrical units", "generator", "hour"),
    "flow_elec": _m("electricity", "Electrical line flow", "model electrical units", "line", "hour", sign="Positive follows the source-to-end bus definition; negative is reverse flow."),
    "angle": _m("electricity", "Bus voltage angle", "radians", "bus", "hour", sign="Positive and negative values are relative to the slack bus."),
    "elec_curtail": _m("electricity", "Electrical curtailment", "model electrical units", "bus", "hour"),
    "cf_gen": _m("electricity", "Generator carbon flow", "model emissions units", "generator", "hour", sign="Positive is carbon flow attributed to generation."),
    "cf_load": _m("electricity", "Load carbon flow", "model emissions units", "bus", "hour", sign="Positive is carbon flow attributed to demand."),
    "X_op": _m("electricity", "Generator operating state", "binary", "generator", "hour"),
    "X_su": _m("electricity", "Generator startup state", "binary", "generator", "hour"),
    "X_sd": _m("electricity", "Generator shutdown state", "binary", "generator", "hour"),
    "gen_segment": _m("electricity", "Generator segment output", "model electrical units", "generator", "segment", "hour"),
    "gen_costs": _m("electricity", "Generator operating cost", "model currency units", "generator", "hour"),
    "soc": _m("storage", "Storage state of charge", "fraction of capacity", "storage_unit", "hour"),
    "charge": _m("storage", "Storage charging", "model storage-flow units", "storage_unit", "hour"),
    "discharge": _m("storage", "Storage discharging", "model storage-flow units", "storage_unit", "hour"),
    "ch": _m("storage", "Storage charging state", "binary", "storage_unit", "hour"),
    "dis": _m("storage", "Storage discharging state", "binary", "storage_unit", "hour"),
    "vx_dock": _m("vehicles", "Vehicle docked state", "binary", "vehicle", "facility", "hour"),
    "vx_move": _m("vehicles", "Vehicle route movement", "binary", "vehicle", "from_facility", "to_facility", "hour"),
    "vx_loc": _m("vehicles", "Vehicle location state", "binary", "vehicle", "hour", "facility"),
    "v_soc": _m("vehicles", "Vehicle state of charge or load", "fraction of capacity", "vehicle", "hour"),
    "v_loccharge": _m("vehicles", "Vehicle loading at facility", "model vehicle-flow units", "vehicle", "facility", "hour"),
    "v_locdischarge": _m("vehicles", "Vehicle unloading at facility", "model vehicle-flow units", "vehicle", "facility", "hour", sign="The unchanged model defines this variable as non-positive; negative values represent unloading."),
    "v_charge": _m("vehicles", "Vehicle total loading", "model vehicle-flow units", "vehicle", "hour"),
    "v_discharge": _m("vehicles", "Vehicle total unloading", "model vehicle-flow units", "vehicle", "hour"),
    "vx_ch": _m("vehicles", "Vehicle loading state", "binary", "vehicle", "hour"),
    "vx_dis": _m("vehicles", "Vehicle unloading state", "binary", "vehicle", "hour"),
    "v_cost": _m("vehicles", "Vehicle operating cost", "model currency units", "vehicle", "hour"),
    "vx_transit": _m("vehicles", "Vehicle in-transit state", "binary", "vehicle", "hour"),
    "shift_x": _m("vehicles", "Vehicle shift assignment", "binary", "shift", "vehicle", "hour"),
    "rw_load": _m("railway", "Railway loading", "model mass units/hour", "train", "hour"),
    "rw_unload": _m("railway", "Railway unloading", "model mass units/hour", "train", "hour"),
    "rw_soc": _m("railway", "Railway load state", "fraction of capacity", "train", "hour"),
    "rw_cost": _m("railway", "Railway operating cost", "model currency units", "train", "hour"),
    "pv_gen": _m("solar", "Solar generation", "kWh", "solar_farm", "hour"),
    "H2_SF": _m("solar", "Solar-powered hydrogen production", "model hydrogen units", "solar_farm", "hour"),
    "sf_to_grid": _m("solar", "Solar power to grid", "kW", "solar_farm", "hour"),
    "sf_to_ely": _m("solar", "Solar power to electrolyser", "kW", "solar_farm", "hour"),
    "sf_slack": _m("solar", "Unused solar generation", "kW", "solar_farm", "hour"),
    "emission_vehicle": _m("emissions", "Vehicle emissions state", "model emissions units", "vehicle", "hour", sign="Positive adds emissions; negative represents modeled removal or offset."),
    "emission_plant": _m("emissions", "Plant emissions state", "model emissions units", "plant", "hour", sign="Positive adds emissions; negative represents modeled removal or offset."),
    "emission_stor": _m("emissions", "Storage emissions state", "model emissions units", "storage_unit", "hour", sign="Positive adds emissions; negative represents modeled removal or offset."),
}


def _as_key(part: Any) -> str | int | float:
    if isinstance(part, (int, float)) and not isinstance(part, bool):
        return int(part) if float(part).is_integer() else float(part)
    return str(part)


def serialize_variable(var: Any, metadata: VariableMeta, tolerance: float) -> dict[str, Any]:
    records: list[dict[str, Any]] = []
    total = missing = zero_omitted = 0
    hour_position = metadata.index_names.index("hour") if "hour" in metadata.index_names else None
    for index, data in var.items():
        total += 1
        raw = data.value
        if raw is None:
            missing += 1
            continue
        try:
            value = float(raw)
        except (TypeError, ValueError):
            missing += 1
            continue
        if not math.isfinite(value):
            missing += 1
            continue
        if abs(value) <= tolerance:
            zero_omitted += 1
            continue
        parts = list(index) if isinstance(index, tuple) else [index]
        keys = [_as_key(part) for part in parts]
        hour = keys[hour_position] if hour_position is not None and hour_position < len(keys) else None
        records.append({"keys": keys, "time": hour, "value": value})
    return {
        "series_id": var.name,
        "title": metadata.title,
        "unit": metadata.unit,
        "index_names": list(metadata.index_names),
        "source_variable": var.name,
        "sign_description": metadata.sign,
        "missing_value_handling": "Unset and non-finite values are omitted and counted.",
        "zero_value_handling": f"Values with absolute magnitude <= {tolerance:g} are omitted and counted.",
        "count": total,
        "missing_count": missing,
        "zero_omitted_count": zero_omitted,
        "records": records,
    }


def serialize_model(model: Any, tolerance: float = 1e-9) -> dict[str, Any]:
    families: dict[str, dict[str, Any]] = {}
    missing_variables: list[str] = []
    for name, metadata in VARIABLE_METADATA.items():
        var = getattr(model, name, None)
        if var is None:
            missing_variables.append(name)
            continue
        families.setdefault(metadata.family, {})[name] = serialize_variable(
            var, metadata, tolerance
        )
    return {"families": families, "missing_variables": missing_variables}


def serialize_sets(model: Any) -> dict[str, list[Any]]:
    wanted = (
        "T", "Facility", "P", "PlantProcess", "Material", "Process", "Bus",
        "Line", "Gen", "Stor", "SF", "V", "V_type", "RW", "Stations",
        "H", "Shifts", "LOC",
    )
    output: dict[str, list[Any]] = {}
    for name in wanted:
        component = getattr(model, name, None)
        if component is None:
            continue
        try:
            output[name] = [
                [_as_key(part) for part in value] if isinstance(value, tuple) else _as_key(value)
                for value in component
            ]
        except Exception:
            continue
    return output
