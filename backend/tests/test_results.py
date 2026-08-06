from __future__ import annotations

from backend.app.services.result_processor import build_charts, build_raw_table
from backend.app.services.result_serializer import VARIABLE_METADATA, serialize_variable


class Datum:
    def __init__(self, value): self.value = value


class VariableWithMissing:
    name = "h2_inven"
    def items(self):
        return [
            (('C1', 1), Datum(2.5)),
            (('C1', 2), Datum(0.0)),
            (('C1', 3), Datum(None)),
        ]


class CompleteSparseVariable:
    name = "H2_charge"
    def items(self):
        return [
            ((hour,), Datum(0.75 if hour == 22 else 0.0))
            for hour in range(1, 25)
        ]


def test_serializer_has_units_indexes_and_missing_policy():
    block = serialize_variable(VariableWithMissing(), VARIABLE_METADATA["h2_inven"], 1e-9)
    assert block["unit"] == "kg H2"
    assert block["index_names"] == ["node", "hour"]
    assert block["missing_count"] == 1
    assert block["zero_omitted_count"] == 1
    assert block["records"] == [{"keys": ["C1", 1], "time": 1, "value": 2.5}]


def test_plot_and_raw_table_use_real_records_without_inventing_missing_values(scenario):
    block = serialize_variable(VariableWithMissing(), VARIABLE_METADATA["h2_inven"], 1e-9)
    payload = {
        "sets": {"T": list(range(1, 25))},
        "results": {"families": {"hydrogen": {"h2_inven": block}}},
    }
    charts = build_charts(payload, scenario)
    chart = next(chart for chart in charts if chart.key == "variable-h2_inven")
    assert chart.chartType == "step"
    assert [(point.t, point.value) for point in chart.series[0].points] == [(1, 2.5)]
    assert "shown as gaps" in (chart.description or "")

    table = build_raw_table(payload, page=1, page_size=1, variable=None)
    assert table.rows[0][1] == "h2_inven"
    assert table.total_rows == 1


def test_plot_reconstructs_omitted_zeros_for_complete_hourly_variables(scenario):
    block = serialize_variable(CompleteSparseVariable(), VARIABLE_METADATA["H2_charge"], 1e-9)
    payload = {
        "sets": {"T": list(range(1, 25))},
        "results": {"families": {"hydrogen": {"H2_charge": block}}},
    }
    charts = build_charts(payload, scenario)
    chart = next(chart for chart in charts if chart.key == "variable-H2_charge")

    assert chart.chartType == "bar"
    assert chart.xLabel == "Hour (1-24)"
    assert len(chart.series[0].points) == 24
    assert chart.series[0].points[0].value == 0.0
    assert chart.series[0].points[21].value == 0.75
    assert chart.series[0].points[23].value == 0.0
    assert "restored as zero" in (chart.description or "")


def test_every_known_variable_has_explicit_metadata():
    assert VARIABLE_METADATA
    for name, metadata in VARIABLE_METADATA.items():
        assert name and metadata.title and metadata.unit and metadata.index_names
