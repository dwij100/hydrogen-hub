"""Canonical schema + typed loading/validation for the 11 solver-consumed tables.

The server is authoritative: the frontend runs a subset of these checks only for
faster feedback. Nothing here mutates the immutable baseline under
`backend/solver/data/`.

The four "wide" containers (plants, solar, vehicles, rw) are NOT normalized
records: each is several independent logical tables padded to a common length.
`LOGICAL_GROUPS` describes those groups so they can be filtered independently
(see input_adapter.filter_wide_table) — filtering a whole row on one group would
corrupt the unrelated groups sharing that row.
"""

from __future__ import annotations

import hashlib
import math
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

from ..schemas import Severity, TableManifest, ValidationIssue

# --- the 11 tables the preserved solver reads, in its import order -----------
CONSUMED_TABLES: tuple[str, ...] = (
    "facilities_johor118",
    "plants_johor118",
    "h2_johor118",
    "power_johor118",
    "storage_johor118",
    "solar_johor118",
    "vehicles_johor118",
    "rw_johor118",
    "pipes_johor118",
    "path_johor118",
    "distances_johor118",
)

MATRIX_TABLES: frozenset[str] = frozenset(
    {"pipes_johor118", "path_johor118", "distances_johor118"}
)


@dataclass(frozen=True)
class TableSpec:
    name: str
    required_columns: tuple[str, ...]
    allow_blank_separator_columns: bool = False
    is_matrix: bool = False
    numeric_columns: tuple[str, ...] = ()
    id_columns: tuple[str, ...] = ()
    logical_groups: dict[str, tuple[str, ...]] = field(default_factory=dict)


POWER_COLUMNS = (
    "Time", "Bus", "Min Angle", "Max Angle", "Line", "Start Bus", "End Bus",
    "Line Capacity", "Line X", "Generator", "Gen Bus", "Min Capacity",
    "Max Capacity", "c", "b", "a", "No Load CC", "Startup CC", "Shutdown CC",
    "Min Ontime", "Min Offtime", "Rampup", "Rampdown", "Corrective Ramp",
    "Load Factor", "Elec Demand", "Init X", "Startup Limit", "Shutdown Limit",
    "T Initial", "Power Initial", "EI Bus", "EI Gen",
)

PLANT_COLUMNS = (
    "Time", "Process Index", "Material Input", "Material Output",
    "Process Stoich", "Plant", "Plant Type", "Plant Index", "Plant Process",
    "Plant Min Capacity", "Plant Max Capacity", "Plant Mat Index",
    "Material Index", "Initial Inventory", "Type Index", "Mat Cap Index",
    "Material Cap",
)

TABLE_SPECS: dict[str, TableSpec] = {
    "facilities_johor118": TableSpec(
        name="facilities_johor118",
        required_columns=("Facility", "Dock Cap"),
        numeric_columns=("Dock Cap",),
        id_columns=("Facility",),
    ),
    "h2_johor118": TableSpec(
        name="h2_johor118",
        required_columns=("Unit", "Demand", "Capacity"),
        numeric_columns=("Demand", "Capacity"),
        id_columns=("Unit",),
    ),
    "storage_johor118": TableSpec(
        name="storage_johor118",
        required_columns=("Unit", "Type", "Capacity", "Stor Bus", "Stor Node"),
        numeric_columns=("Capacity",),
        id_columns=("Unit",),
    ),
    "plants_johor118": TableSpec(
        name="plants_johor118",
        required_columns=PLANT_COLUMNS,
        allow_blank_separator_columns=True,
        numeric_columns=(
            "Time", "Process Stoich", "Plant Min Capacity",
            "Plant Max Capacity", "Initial Inventory", "Material Cap",
        ),
        logical_groups={
            "time": ("Time",),
            "process": (
                "Process Index", "Material Input", "Material Output",
                "Process Stoich",
            ),
            "plant": ("Plant", "Plant Type"),
            "plant_process": (
                "Plant Index", "Plant Process", "Plant Min Capacity",
                "Plant Max Capacity",
            ),
            "inventory": ("Plant Mat Index", "Material Index", "Initial Inventory"),
            "material_cap": ("Type Index", "Mat Cap Index", "Material Cap"),
        },
    ),
    "power_johor118": TableSpec(
        name="power_johor118",
        required_columns=POWER_COLUMNS,
        allow_blank_separator_columns=True,
        numeric_columns=(
            "Time", "Min Angle", "Max Angle", "Line Capacity", "Line X",
            "Min Capacity", "Max Capacity", "c", "b", "a", "No Load CC",
            "Startup CC", "Shutdown CC", "Min Ontime", "Min Offtime", "Rampup",
            "Rampdown", "Load Factor", "Elec Demand", "Startup Limit",
            "Shutdown Limit", "T Initial", "Power Initial", "EI Bus", "EI Gen",
        ),
        id_columns=("Bus", "Line", "Generator"),
    ),
    "solar_johor118": TableSpec(
        name="solar_johor118",
        required_columns=(
            "time", "Time", "Site_1 Power", "Site_2 Power", "Solar Farms",
            "SF Bus", "Site1 48kwp", "SF Index", "Time Index", "Site Power",
        ),
        allow_blank_separator_columns=True,
        numeric_columns=("Time", "Site_1 Power", "Site_2 Power", "Site Power"),
        logical_groups={
            "profile": ("time", "Time", "Site_1 Power", "Site_2 Power"),
            "farms": ("Solar Farms", "SF Bus", "Site1 48kwp"),
            "site_power": ("SF Index", "Time Index", "Site Power"),
        },
    ),
    "vehicles_johor118": TableSpec(
        name="vehicles_johor118",
        required_columns=(
            "Location", "Dock Cap E", "Dock Cap H", "Location Bus", "Vehicle",
            "Vehicle Type", "Initial Loc", "Shift", "Shift Start", "Shift End",
            "Shift LOC", "Shift Distance",
        ),
        allow_blank_separator_columns=True,
        numeric_columns=(
            "Dock Cap E", "Dock Cap H", "Shift Start", "Shift End",
            "Shift Distance",
        ),
        logical_groups={
            "locations": ("Location", "Dock Cap E", "Dock Cap H", "Location Bus"),
            "vehicles": ("Vehicle", "Vehicle Type", "Initial Loc"),
            "shifts": (
                "Shift", "Shift Start", "Shift End", "Shift LOC",
                "Shift Distance",
            ),
        },
    ),
    "rw_johor118": TableSpec(
        name="rw_johor118",
        required_columns=(
            "Time", "Stations", "Trains", "RW Path", "RW Index", "Time Index",
            "Rail Freight Stations", "Latitude", "Longitude",
        ),
        allow_blank_separator_columns=True,
        numeric_columns=("Time", "Latitude", "Longitude"),
        logical_groups={
            "time": ("Time",),
            "stations": ("Stations",),
            "trains": ("Trains",),
            "paths": ("RW Path", "RW Index", "Time Index"),
            "geo": ("Rail Freight Stations", "Latitude", "Longitude"),
        },
    ),
    "pipes_johor118": TableSpec(
        name="pipes_johor118", required_columns=(), is_matrix=True
    ),
    "path_johor118": TableSpec(
        name="path_johor118", required_columns=(), is_matrix=True
    ),
    "distances_johor118": TableSpec(
        name="distances_johor118", required_columns=(), is_matrix=True
    ),
}

# Regression checks for the supplied baseline only. An independently uploaded
# complete dataset must be internally consistent but need not match these.
BASELINE_COUNTS: dict[str, int] = {
    "facilities": 65,
    "time_periods": 24,
    "plants": 46,
    "plant_processes": 20,
    "buses": 118,
    "lines": 186,
    "generators": 54,
    "storage_units": 28,
    "solar_farms": 2,
    "vehicles": 75,
    "vehicle_locations": 13,
    "shifts": 30,
    "trains": 3,
    "stations": 2,
    "h2_nodes": 9,
}

_BLANK_COL = re.compile(r"^(Unnamed:\s*\d+)?$")


def normalize_header(raw: object) -> str:
    """Normalize Unicode + surrounding whitespace, preserving identifier case."""
    text = "" if raw is None else str(raw)
    text = unicodedata.normalize("NFKC", text)
    return text.strip()


def is_blank_column(name: str) -> bool:
    return bool(_BLANK_COL.match(name.strip()))


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def sha256_frame(df: pd.DataFrame) -> str:
    """Stable content hash of a table: identical CSV and XLSX input hash equal."""
    return sha256_bytes(df.to_csv(index=False, lineterminator="\n").encode("utf-8"))


class Dataset:
    """A validated in-memory copy of the 11 solver-consumed tables."""

    def __init__(self, frames: dict[str, pd.DataFrame]):
        self.frames = frames

    def manifest(self) -> list[TableManifest]:
        return [
            TableManifest(
                name=name,
                rows=int(len(df)),
                columns=[str(c) for c in df.columns],
                sha256=sha256_frame(df),
            )
            for name, df in sorted(self.frames.items())
        ]

    def counts(self) -> dict[str, int]:
        f = self.frames

        def uniq(table: str, column: str) -> int:
            if table not in f or column not in f[table].columns:
                return 0
            return int(f[table][column].dropna().nunique())

        return {
            "facilities": uniq("facilities_johor118", "Facility"),
            "time_periods": uniq("power_johor118", "Time"),
            "plants": uniq("plants_johor118", "Plant"),
            "plant_processes": int(
                f["plants_johor118"][["Plant Index", "Plant Process"]].dropna().shape[0]
            )
            if "plants_johor118" in f
            else 0,
            "buses": uniq("power_johor118", "Bus"),
            "lines": uniq("power_johor118", "Line"),
            "generators": uniq("power_johor118", "Generator"),
            "storage_units": uniq("storage_johor118", "Unit"),
            "solar_farms": uniq("solar_johor118", "Solar Farms"),
            "vehicles": uniq("vehicles_johor118", "Vehicle"),
            "vehicle_locations": uniq("vehicles_johor118", "Location"),
            "shifts": uniq("vehicles_johor118", "Shift"),
            "trains": uniq("rw_johor118", "Trains"),
            "stations": uniq("rw_johor118", "Stations"),
            "h2_nodes": uniq("h2_johor118", "Unit"),
        }


def read_csv_table(name: str, source: Path | bytes) -> pd.DataFrame:
    spec = TABLE_SPECS[name]
    kwargs: dict[str, object] = {"index_col": 0} if spec.is_matrix else {}
    if isinstance(source, bytes):
        import io

        df = pd.read_csv(io.BytesIO(source), **kwargs)  # type: ignore[arg-type]
    else:
        df = pd.read_csv(source, **kwargs)  # type: ignore[arg-type]
    df.columns = [normalize_header(c) for c in df.columns]
    if spec.is_matrix:
        df.index = [normalize_header(i) for i in df.index]
    return df


def load_bundled(dataset_dir: Path) -> Dataset:
    """Load the immutable baseline CSVs (read-only, never mutated)."""
    frames: dict[str, pd.DataFrame] = {}
    for name in CONSUMED_TABLES:
        path = dataset_dir / f"{name}.csv"
        if not path.is_file():
            raise FileNotFoundError(f"missing baseline table: {name}.csv")
        frames[name] = read_csv_table(name, path)
    return Dataset(frames)


# --- validation -------------------------------------------------------------


def _issue(
    severity: Severity,
    code: str,
    sheet: str,
    message: str,
    *,
    row: int | None = None,
    column: str | None = None,
    value: object | None = None,
    expected: str | None = None,
) -> ValidationIssue:
    return ValidationIssue(
        severity=severity,
        code=code,
        sheet=sheet,
        row=row,
        column=column,
        value=None if value is None else str(value),
        expected=expected,
        message=message,
    )


def _validate_columns(name: str, df: pd.DataFrame) -> list[ValidationIssue]:
    spec = TABLE_SPECS[name]
    issues: list[ValidationIssue] = []
    present = [str(c) for c in df.columns]
    if not spec.allow_blank_separator_columns:
        for column in present:
            if is_blank_column(column):
                issues.append(
                    _issue(
                        Severity.error,
                        "unexpected_blank_column",
                        name,
                        f"'{name}' does not allow unnamed separator columns.",
                        column=column,
                    )
                )
    missing = [c for c in spec.required_columns if c not in present]
    for column in missing:
        issues.append(
            _issue(
                Severity.error,
                "missing_header",
                name,
                f"Required column '{column}' is missing from '{name}'.",
                column=column,
                expected=column,
            )
        )
    seen: set[str] = set()
    for column in present:
        if is_blank_column(column):
            continue
        if column in seen:
            issues.append(
                _issue(
                    Severity.error,
                    "duplicate_header",
                    name,
                    f"Column '{column}' appears more than once in '{name}'.",
                    column=column,
                )
            )
        seen.add(column)
    return issues


def _validate_numeric(name: str, df: pd.DataFrame) -> list[ValidationIssue]:
    spec = TABLE_SPECS[name]
    issues: list[ValidationIssue] = []
    for column in spec.numeric_columns:
        if column not in df.columns:
            continue
        series = df[column]
        for position, raw in enumerate(series.tolist(), start=1):
            if raw is None or (isinstance(raw, float) and math.isnan(raw)):
                continue  # padded cell in a wide container
            try:
                value = float(raw)
            except (TypeError, ValueError):
                issues.append(
                    _issue(
                        Severity.error,
                        "non_numeric_value",
                        name,
                        f"'{raw}' in column '{column}' is not a number.",
                        row=position,
                        column=column,
                        value=raw,
                        expected="finite number",
                    )
                )
                continue
            if math.isinf(value):
                issues.append(
                    _issue(
                        Severity.error,
                        "non_finite_value",
                        name,
                        f"Column '{column}' contains a non-finite value.",
                        row=position,
                        column=column,
                        value=raw,
                        expected="finite number",
                    )
                )
    return issues


def _validate_ids(name: str, df: pd.DataFrame) -> list[ValidationIssue]:
    spec = TABLE_SPECS[name]
    issues: list[ValidationIssue] = []
    for column in spec.id_columns:
        if column not in df.columns:
            continue
        values = df[column].dropna().astype(str).str.strip()
        blanks = values[values == ""]
        for position in blanks.index.tolist():
            issues.append(
                _issue(
                    Severity.error,
                    "blank_id",
                    name,
                    f"Identifier column '{column}' has a blank value.",
                    row=int(position) + 1,
                    column=column,
                )
            )
        duplicated = values[values.duplicated()]
        for position, value in duplicated.items():
            issues.append(
                _issue(
                    Severity.error,
                    "duplicate_id",
                    name,
                    f"Identifier '{value}' is duplicated in column '{column}'.",
                    row=int(position) + 1,
                    column=column,
                    value=value,
                )
            )
    return issues


def _validate_matrix(name: str, df: pd.DataFrame) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    rows = [str(i) for i in df.index]
    cols = [str(c) for c in df.columns]
    if len(set(rows)) != len(rows):
        issues.append(
            _issue(Severity.error, "duplicate_matrix_label", name, "Row labels must be unique.")
        )
    if len(set(cols)) != len(cols):
        issues.append(
            _issue(Severity.error, "duplicate_matrix_label", name, "Column labels must be unique.")
        )
    if rows != cols:
        issues.append(
            _issue(
                Severity.error,
                "matrix_shape_mismatch",
                name,
                f"'{name}' must be square with identical row and column labels "
                f"in the same order ({len(rows)} rows vs {len(cols)} columns).",
                expected="square matrix, identical labels in identical order",
            )
        )
    return issues


def _validate_cross_references(frames: dict[str, pd.DataFrame]) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    if not {"facilities_johor118"} <= frames.keys():
        return issues
    facilities = set(frames["facilities_johor118"]["Facility"].dropna().astype(str))

    def check_subset(table: str, column: str, code: str, label: str) -> None:
        if table not in frames or column not in frames[table].columns:
            return
        for position, value in frames[table][column].dropna().astype(str).items():
            if value not in facilities:
                issues.append(
                    _issue(
                        Severity.error,
                        code,
                        table,
                        f"{label} '{value}' is not present in facilities_johor118.",
                        row=int(position) + 1,
                        column=column,
                        value=value,
                        expected="a Facility defined in facilities_johor118",
                    )
                )

    check_subset("plants_johor118", "Plant", "unknown_facility", "Plant")
    check_subset("solar_johor118", "Solar Farms", "unknown_facility", "Solar farm")
    check_subset("h2_johor118", "Unit", "unknown_facility", "H2 node")
    check_subset("vehicles_johor118", "Location", "unknown_facility", "Vehicle location")
    check_subset("rw_johor118", "Stations", "unknown_facility", "Rail station")

    # Time coverage must be contiguous 1..N.
    if "power_johor118" in frames and "Time" in frames["power_johor118"].columns:
        times = sorted(
            {int(t) for t in frames["power_johor118"]["Time"].dropna().astype(int)}
        )
        if times and times != list(range(times[0], times[0] + len(times))):
            issues.append(
                _issue(
                    Severity.error,
                    "time_coverage_gap",
                    "power_johor118",
                    "Time periods must be contiguous with no gaps.",
                    column="Time",
                    expected=f"{times[0]}..{times[0] + len(times) - 1}",
                )
            )

    # Matrix labels must cover the facility / H2 sets.
    for table, universe, label in (
        ("path_johor118", facilities, "facility"),
        ("distances_johor118", facilities, "facility"),
    ):
        if table in frames:
            labels = {str(i) for i in frames[table].index}
            missing = sorted(facilities - labels)
            if missing:
                issues.append(
                    _issue(
                        Severity.error,
                        "matrix_missing_label",
                        table,
                        f"Matrix is missing {len(missing)} {label} label(s), "
                        f"e.g. {', '.join(missing[:5])}.",
                        expected="one row/column per facility",
                    )
                )
    if "pipes_johor118" in frames and "h2_johor118" in frames:
        h2_nodes = set(frames["h2_johor118"]["Unit"].dropna().astype(str))
        labels = {str(i) for i in frames["pipes_johor118"].index}
        missing = sorted(h2_nodes - labels)
        if missing:
            issues.append(
                _issue(
                    Severity.error,
                    "matrix_missing_label",
                    "pipes_johor118",
                    f"Pipe matrix is missing H2 node(s): {', '.join(missing[:5])}.",
                    expected="one row/column per H2 node",
                )
            )
    return issues


def validate_dataset(dataset: Dataset) -> list[ValidationIssue]:
    """Full authoritative validation. Returns every finding, not just the first."""
    issues: list[ValidationIssue] = []
    for name in CONSUMED_TABLES:
        if name not in dataset.frames:
            issues.append(
                _issue(
                    Severity.error,
                    "missing_table",
                    name,
                    f"Required table '{name}' is missing.",
                    expected=f"{name}.csv or sheet '{name}'",
                )
            )
            continue
        df = dataset.frames[name]
        if df.empty:
            issues.append(
                _issue(Severity.error, "empty_table", name, f"'{name}' has no data rows.")
            )
        if TABLE_SPECS[name].is_matrix:
            issues.extend(_validate_matrix(name, df))
        else:
            issues.extend(_validate_columns(name, df))
            issues.extend(_validate_numeric(name, df))
            issues.extend(_validate_ids(name, df))
    if not any(i.severity is Severity.error for i in issues):
        issues.extend(_validate_cross_references(dataset.frames))
    return issues
