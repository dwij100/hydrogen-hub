from __future__ import annotations

from backend.app.config import Settings
from backend.app.database import IdempotencyConflict, RunStore
from backend.app.schemas import RunRequest, RunStatus
from backend.tests.conftest import SOLVER_DIR


def request(scenario, key="12345678", input_hash="hash-1"):
    return RunRequest(project_id="p1", input_hash=input_hash, idempotency_key=key, scenario=scenario)


def test_idempotent_submission_persists_across_store_instances(tmp_path, scenario):
    settings = Settings(solver_dir=SOLVER_DIR, data_dir=tmp_path)
    first = RunStore(settings)
    row, duplicate = first.create_or_get(request(scenario))
    assert not duplicate
    second = RunStore(settings)
    again, duplicate = second.create_or_get(request(scenario))
    assert duplicate and again["id"] == row["id"]


def test_idempotency_conflict_is_rejected(tmp_path, scenario):
    store = RunStore(Settings(solver_dir=SOLVER_DIR, data_dir=tmp_path))
    store.create_or_get(request(scenario))
    try:
        store.create_or_get(request(scenario, input_hash="different"))
    except IdempotencyConflict:
        pass
    else:
        raise AssertionError("conflicting idempotency key was accepted")


def test_atomic_claim_cancel_and_restart_recovery(tmp_path, scenario):
    store = RunStore(Settings(solver_dir=SOLVER_DIR, data_dir=tmp_path))
    row, _ = store.create_or_get(request(scenario))
    claimed = store.claim_next()
    assert claimed and claimed["id"] == row["id"] and claimed["status"] == RunStatus.preparing.value
    assert store.claim_next() is None
    store.update(row["id"], status=RunStatus.solving.value, worker_pid=123)
    assert store.recover_interrupted() == 1
    assert store.get(row["id"])["status"] == RunStatus.queued.value
    cancelled = store.request_cancel(row["id"])
    assert cancelled["status"] == RunStatus.cancelled.value


def test_queue_counts_do_not_double_count_queued(tmp_path, scenario):
    store = RunStore(Settings(solver_dir=SOLVER_DIR, data_dir=tmp_path))
    store.create_or_get(request(scenario))
    assert store.queue_counts() == (1, 0)
