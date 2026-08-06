"""Subprocess entry point: build and solve the audited model, emit JSON.

Invoked as `python -m backend.app.services.runner_entry <job_dir> <out.json>`
with the process working directory set to the job directory, because the
staged solver reads its 11 tables with fixed relative filenames at import
time. It is imported as a module so its `if __name__ == "__main__":` block —
which calls plt.show() — never executes.
"""

from __future__ import annotations

import gzip
import importlib.util
import json
import os
import resource
import sys
import time
from pathlib import Path



def _event(name: str, **fields: object) -> None:
    """Write a compact, credential-free phase marker to the per-run log."""
    print(
        "[hydrogen-run] "
        + json.dumps({"event": name, **fields}, sort_keys=True, default=str),
        flush=True,
    )


def _load_solver(job_dir: Path):
    """Load the staged solver through its normal Python import path."""
    module_path = job_dir / "HSC_operational.py"
    spec = importlib.util.spec_from_file_location("hsc_operational_run", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("solver module could not be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _write_iis(model: object, out_path: Path) -> dict[str, object]:
    """Generate Gurobi IIS files for the staged model."""
    import gurobipy as gp

    run_name = out_path.name.removesuffix(".json.gz")
    result_dir = out_path.parent
    result_dir.mkdir(parents=True, exist_ok=True)
    source_lp = result_dir / f".{run_name}.iis-source.lp"
    iis_model = result_dir / f"{run_name}.iis.ilp"
    iis_summary = result_dir / f"{run_name}.iis.json"
    environment = None
    grb_model = None
    try:
        # Symbolic names make the IIS actionable (for example,
        # store.soc_cons[HT1,1]) instead of exposing anonymous row numbers.
        model.write(  # type: ignore[attr-defined]
            str(source_lp),
            format="lp",
            io_options={"symbolic_solver_labels": True},
        )
        environment = gp.Env(empty=True)
        environment.setParam("OutputFlag", 0)
        environment.start()
        grb_model = gp.read(str(source_lp), environment)
        grb_model.Params.OutputFlag = 0
        grb_model.computeIIS()
        grb_model.write(str(iis_model))

        constraints = [
            constraint.ConstrName
            for constraint in grb_model.getConstrs()
            if constraint.IISConstr
        ]
        variable_bounds = [
            {
                "variable": variable.VarName,
                "lower_bound_in_iis": bool(variable.IISLB),
                "upper_bound_in_iis": bool(variable.IISUB),
            }
            for variable in grb_model.getVars()
            if variable.IISLB or variable.IISUB
        ]
        summary = {
            "diagnostic": "Gurobi irreducible inconsistent subsystem (IIS)",
            "constraint_count": len(constraints),
            "variable_bound_count": len(variable_bounds),
            "constraints": constraints,
            "variable_bounds": variable_bounds,
            "iis_model_file": iis_model.name,
        }
        iis_summary.write_text(
            json.dumps(summary, indent=2, sort_keys=True), encoding="utf-8"
        )
        return {
            "summary_file": iis_summary.name,
            "model_file": iis_model.name,
            "constraint_count": len(constraints),
            "variable_bound_count": len(variable_bounds),
        }
    finally:
        source_lp.unlink(missing_ok=True)
        if grb_model is not None:
            grb_model.dispose()
        if environment is not None:
            environment.dispose()


def main() -> int:
    os.environ.setdefault("MPLBACKEND", "Agg")
    job_dir = Path(sys.argv[1]).resolve()
    out_path = Path(sys.argv[2]).resolve()
    solver_name = os.environ.get("SOLVER_NAME", "gurobi")
    time_limit = int(os.environ.get("SOLVE_TIMEOUT_SECONDS", "21600"))
    tolerance = float(os.environ.get("ZERO_TOLERANCE", "1e-9"))

    os.chdir(job_dir)
    sys.path.insert(0, str(job_dir))
    sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

    from backend.app.services.result_serializer import serialize_model, serialize_sets

    payload: dict[str, object] = {"stage": "building"}
    started = time.time()
    try:
        import pyomo.environ as pyo

        _event("build_started", input_directory=str(job_dir))
        module = _load_solver(job_dir)
        model = module.build_model()
        build_seconds = time.time() - started
        _event(
            "model_built",
            variables=int(model.nvariables()),
            constraints=int(model.nconstraints()),
            build_seconds=round(build_seconds, 3),
        )

        payload["stage"] = "solving"
        opt = pyo.SolverFactory(solver_name)
        if not opt.available(exception_flag=False):
            raise RuntimeError(
                f"solver '{solver_name}' is not available in this environment"
            )
        opt.options["TimeLimit" if solver_name == "gurobi" else "timelimit"] = time_limit

        _event("solve_started", solver=solver_name, time_limit_seconds=time_limit)
        solve_started = time.time()
        results = opt.solve(model, tee=False, load_solutions=False)
        solve_seconds = time.time() - solve_started

        status = str(results.solver.status)
        termination = str(results.solver.termination_condition)
        _event(
            "solve_finished",
            solver_status=status,
            termination_condition=termination,
            solve_seconds=round(solve_seconds, 3),
        )
        objective_value = None
        serialized: dict[str, object] = {"families": {}, "missing_variables": []}
        sets: dict[str, object] = {}

        if termination.lower() in {"infeasible", "infeasibleorunbounded"}:
            try:
                payload["iis_diagnostics"] = _write_iis(model, out_path)
                _event("iis_written", **payload["iis_diagnostics"])
            except Exception as exc:  # noqa: BLE001 - preserve primary result
                payload["iis_warning"] = (
                    f"IIS generation failed: {exc.__class__.__name__}"
                )
                _event("iis_failed", error_type=exc.__class__.__name__)

        if termination in {"optimal", "feasible", "maxTimeLimit", "maxTimeLimitWithSolution", "other"} and getattr(
            results.solver, "status", None
        ) is not None:
            try:
                model.solutions.load_from(results)
                payload["stage"] = "serializing"
                serialized = serialize_model(model, tolerance)
                sets = serialize_sets(model)
                objective = next(
                    model.component_data_objects(pyo.Objective, active=True), None
                )
                if objective is not None:
                    objective_value = float(pyo.value(objective))
            except Exception as exc:  # noqa: BLE001
                payload["load_warning"] = f"no solution could be loaded: {exc.__class__.__name__}"

        peak_kb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        payload.update(
            {
                "stage": "completed",
                "solver_status": status,
                "termination_condition": termination,
                "objective_name": "Total hydrogen imbalance",
                "objective_unit": "model hydrogen units",
                "objective_value": objective_value,
                "num_variables": int(model.nvariables()),
                "num_constraints": int(model.nconstraints()),
                "build_seconds": build_seconds,
                "solve_seconds": solve_seconds,
                "peak_memory_mb": peak_kb / 1024.0,
                "sets": sets,
                "results": serialized,
            }
        )
    except Exception as exc:  # noqa: BLE001 - the parent maps this to a safe code
        payload.update(
            {
                "stage": "failed",
                "error_type": exc.__class__.__name__,
                "error_detail": str(exc),
            }
        )
        _event(
            "run_failed",
            error_type=exc.__class__.__name__,
            error_detail=str(exc)[:1000],
        )

    with gzip.open(out_path, "wt", encoding="utf-8") as handle:
        json.dump(payload, handle)
    _event("artifact_written", stage=payload.get("stage"), artifact=out_path.name)
    return 0 if payload.get("stage") == "completed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
