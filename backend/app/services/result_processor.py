"""Convert persisted raw Pyomo records into plot-ready and filterable API results."""

from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass
from typing import Any, Literal

from ..schemas import (
    DatasetSummary,
    ResultChartGroup,
    ResultSeries,
    ResultSeriesPoint,
    ResultsResponse,
    ResultTable,
    ScenarioConfig,
)
from .input_adapter import CONSUMER_MAP

ChartType = Literal["line", "step", "bar"]
YAxisMode = Literal["auto", "fraction", "binary"]


@dataclass(frozen=True)
class ChartDefinition:
    category: str
    label: str
    chart_type: ChartType
    y_axis_mode: YAxisMode = "auto"
    series_limit: int = 12


# Chart types are selected by meaning rather than by point count:
# - line: continuous hourly profiles such as solar output and line flow;
# - step: hourly states/inventories that are constant within each model interval;
# - bar: discrete hourly dispatch, charging, loading, or transfer events.
CHART_VARIABLES: dict[str, ChartDefinition] = {
    "process_res": ChartDefinition("utilization", "Plant processing rates", "bar", series_limit=10),
    "plant_inven": ChartDefinition("utilization", "Plant inventories", "step", series_limit=10),
    "h2_inven": ChartDefinition("flows", "Hydrogen inventory by node", "step", series_limit=10),
    "pipe_out": ChartDefinition("flows", "Hydrogen pipeline outflow", "bar", series_limit=8),
    "H2_charge": ChartDefinition("storage", "System hydrogen charging", "bar"),
    "H2_discharge": ChartDefinition("storage", "System hydrogen discharging", "bar"),
    "soc": ChartDefinition("storage", "Storage state of charge", "step", "fraction", 6),
    "charge": ChartDefinition("storage", "Storage charging", "bar", series_limit=6),
    "discharge": ChartDefinition("storage", "Storage discharging", "bar", series_limit=6),
    "v_soc": ChartDefinition("transport", "Vehicle state of charge or load", "step", "fraction", 6),
    "vx_transit": ChartDefinition("transport", "Vehicles in transit", "step", "binary", 12),
    "rw_load": ChartDefinition("transport", "Railway loading", "bar"),
    "rw_unload": ChartDefinition("transport", "Railway unloading", "bar"),
    "rw_soc": ChartDefinition("transport", "Railway load state", "step", "fraction"),
    "pv_gen": ChartDefinition("production", "Solar generation", "line"),
    "H2_SF": ChartDefinition("production", "Solar-powered hydrogen production", "line"),
    "gen_elec": ChartDefinition("utilization", "Electrical generation", "bar", series_limit=8),
    "flow_elec": ChartDefinition("flows", "Electrical line flow", "line", series_limit=6),
}


def _iter_variables(payload: dict[str, Any]):
    for family, variables in payload.get("results", {}).get("families", {}).items():
        for name, block in variables.items():
            yield family, name, block


def _hour_axis(payload: dict[str, Any]) -> list[int]:
    """Return the solved model's numeric time axis, with the supported 24-hour fallback."""
    hours: set[int] = set()
    for raw in payload.get("sets", {}).get("T", []):
        try:
            hour = int(raw)
        except (TypeError, ValueError):
            continue
        hours.add(hour)
    return sorted(hours) if hours else list(range(1, 25))


def _series_for(
    block: dict[str, Any],
    hours: list[int],
    limit: int,
) -> tuple[list[ResultSeries], int, bool]:
    """Build chart series and safely restore serializer-omitted zeros.

    The serializer deliberately excludes near-zero values to keep artifacts and the raw
    table compact. If the block has no genuinely missing/unset values, every absent hour
    for an entity is therefore known to be zero and can be restored. If missing values
    exist, absent hours remain gaps because zero and missing cannot be distinguished.
    """
    indexes = list(block.get("index_names", []))
    if "hour" not in indexes:
        return [], 0, False

    hour_position = indexes.index("hour")
    entity_positions = [position for position, name in enumerate(indexes) if name != "hour"]
    point_values: dict[str, dict[int, float]] = defaultdict(dict)
    magnitudes: dict[str, float] = defaultdict(float)

    for record in block.get("records", []):
        keys = record.get("keys", [])
        if hour_position >= len(keys):
            continue
        try:
            hour = int(keys[hour_position])
            value = float(record["value"])
        except (TypeError, ValueError, KeyError):
            continue
        entities = [
            f"{indexes[position]}={keys[position]}"
            for position in entity_positions
            if position < len(keys)
        ]
        label = ", ".join(entities) if entities else block.get("title", block.get("series_id", "Series"))
        point_values[label][hour] = value
        magnitudes[label] += abs(value)

    selected = sorted(point_values, key=lambda key: magnitudes[key], reverse=True)[:limit]
    omitted_count = max(0, len(point_values) - len(selected))
    can_restore_zeros = int(block.get("missing_count", 0) or 0) == 0

    output: list[ResultSeries] = []
    for index, label in enumerate(selected):
        values = point_values[label]
        if can_restore_zeros:
            points = [
                ResultSeriesPoint(t=hour, value=values.get(hour, 0.0))
                for hour in hours
            ]
        else:
            points = [
                ResultSeriesPoint(t=hour, value=values[hour])
                for hour in sorted(values)
            ]
        output.append(
            ResultSeries(
                key=f"{block.get('series_id', 'series')}:{index}",
                label=label,
                unit=str(block.get("unit", "model units")),
                points=points,
            )
        )
    return output, omitted_count, can_restore_zeros


def _demand_chart(scenario: ScenarioConfig, hours: list[int]) -> ResultChartGroup:
    series = []
    divisor = float(len(hours) or 24)
    for item in scenario.consumers:
        node = CONSUMER_MAP[item.consumer_id]
        hourly = float(item.demand_kg_per_day) / divisor
        series.append(
            ResultSeries(
                key=f"demand:{node}",
                label=node,
                unit="kg H2/hour",
                points=[ResultSeriesPoint(t=hour, value=hourly) for hour in hours],
            )
        )
    return ResultChartGroup(
        key="submitted-hydrogen-demand",
        label="Submitted hydrogen demand",
        category="flows",
        xLabel=f"Hour ({hours[0]}-{hours[-1]})",
        unit="kg H2/hour",
        series=series,
        chartType="step",
        yAxisMode="auto",
        description=(
            "The model consumes one aggregate demand per consumer over the full horizon. "
            "For display, each submitted total is allocated evenly across the hourly steps."
        ),
    )


def build_charts(payload: dict[str, Any], scenario: ScenarioConfig) -> list[ResultChartGroup]:
    hours = _hour_axis(payload)
    charts: list[ResultChartGroup] = [_demand_chart(scenario, hours)]
    for _, name, block in _iter_variables(payload):
        definition = CHART_VARIABLES.get(name)
        if not definition:
            continue
        series, omitted_count, zeros_restored = _series_for(
            block, hours, definition.series_limit
        )
        if not series:
            continue

        description_parts = [
            f"Source variable: {block.get('source_variable', name)}.",
            str(block.get("sign_description", "")).strip(),
        ]
        if zeros_restored:
            description_parts.append(
                "Near-zero values omitted from the compact raw artifact are restored as zero "
                "so every displayed series spans the full model horizon."
            )
        else:
            description_parts.append(
                "The source contains unset values; unresolved hours are shown as gaps rather than being assumed zero."
            )
        if omitted_count:
            description_parts.append(
                f"The chart shows the {definition.series_limit} largest series by total absolute activity; "
                f"{omitted_count} additional series remain available in the raw-variable table."
            )

        charts.append(
            ResultChartGroup(
                key=f"variable-{name}",
                label=definition.label,
                category=definition.category,  # type: ignore[arg-type]
                xLabel=f"Hour ({hours[0]}-{hours[-1]})",
                unit=str(block.get("unit", "model units")),
                series=series,
                chartType=definition.chart_type,
                yAxisMode=definition.y_axis_mode,
                description=" ".join(part for part in description_parts if part).strip(),
            )
        )
    return charts


def build_raw_table(
    payload: dict[str, Any], *, page: int, page_size: int, variable: str | None
) -> ResultTable:
    rows: list[list[str | int | float | bool | None]] = []
    for family, name, block in _iter_variables(payload):
        if variable and name != variable:
            continue
        indexes = list(block.get("index_names", []))
        for record in block.get("records", []):
            keys = record.get("keys", [])
            index_map = {
                index_name: keys[position] if position < len(keys) else None
                for position, index_name in enumerate(indexes)
            }
            rows.append(
                [
                    family,
                    name,
                    block.get("title", name),
                    block.get("unit", "model units"),
                    json.dumps(index_map, separators=(",", ":")),
                    record.get("time"),
                    float(record["value"]),
                    block.get("sign_description", ""),
                    block.get("source_variable", name),
                ]
            )
    start = (page - 1) * page_size
    window = rows[start : start + page_size]
    return ResultTable(
        key="raw-variables",
        label="Non-zero raw solver variables",
        columns=[
            "Family", "Variable", "Title", "Unit", "Indices", "Hour", "Value",
            "Sign meaning", "Source variable",
        ],
        rows=window,
        total_rows=len(rows),
        page=page,
        page_size=page_size,
        truncated=start + len(window) < len(rows),
    )


def build_results_response(
    payload: dict[str, Any],
    row: dict[str, Any],
    scenario: ScenarioConfig,
    *,
    page: int,
    page_size: int,
    variable: str | None = None,
) -> ResultsResponse:
    summary = json.loads(row["summary_json"])
    objective = summary.get("objective_value")
    termination = summary.get("termination_condition")
    if objective is None or not termination:
        raise ValueError("Completed run is missing objective or termination metadata.")
    return ResultsResponse(
        run_id=row["id"],
        solver_name="gurobi",
        termination_condition=str(termination),
        objective_value=float(objective),
        objective_label="Total hydrogen imbalance",
        objective_unit="model hydrogen units",
        solve_seconds=summary.get("solve_seconds"),
        dataset=DatasetSummary(),
        input_summary={
            "Dataset": "Johor 118 (bundled)",
            "Horizon": "24 hourly steps",
            "Selected infrastructure": len(scenario.infrastructure_ids),
            "Selected solar farms": len(scenario.solar_farm_ids),
            "Consumers": len(scenario.consumers),
            "Consumer demand (kg H2/day)": sum(
                item.demand_kg_per_day for item in scenario.consumers
            ),
            "Vehicle templates": scenario.vehicles.total(),
            "Railway enabled": scenario.railway.enabled,
        },
        charts=build_charts(payload, scenario),
        tables=[build_raw_table(payload, page=page, page_size=page_size, variable=variable)],
    )
