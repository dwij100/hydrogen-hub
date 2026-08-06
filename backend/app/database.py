"""Crash-safe SQLite run queue shared by the API and single worker containers."""

from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from .config import Settings
from .schemas import CANCELLABLE_STATUSES, RunRequest, RunStatus

ACTIVE_VALUES = tuple(
    status.value for status in CANCELLABLE_STATUSES if status is not RunStatus.queued
)
TERMINAL_VALUES = (
    RunStatus.completed.value,
    RunStatus.failed.value,
    RunStatus.cancelled.value,
    RunStatus.timed_out.value,
)


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


class IdempotencyConflict(ValueError):
    pass


class RunStore:
    def __init__(self, settings: Settings):
        self.settings = settings
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        settings.runs_dir.mkdir(parents=True, exist_ok=True)
        settings.result_dir.mkdir(parents=True, exist_ok=True)
        settings.log_dir.mkdir(parents=True, exist_ok=True)
        self.initialize()

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(
            self.settings.database_path,
            timeout=30,
            isolation_level=None,
            check_same_thread=False,
        )
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA busy_timeout=30000")
        return connection

    @contextmanager
    def immediate(self) -> Iterator[sqlite3.Connection]:
        connection = self.connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            yield connection
            connection.execute("COMMIT")
        except Exception:
            connection.execute("ROLLBACK")
            raise
        finally:
            connection.close()

    def initialize(self) -> None:
        with self.connect() as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS runs (
                    id TEXT PRIMARY KEY,
                    project_id TEXT,
                    project_name TEXT,
                    user_id TEXT NOT NULL DEFAULT 'local-user',
                    idempotency_key TEXT NOT NULL,
                    input_hash TEXT NOT NULL,
                    scenario_json TEXT NOT NULL,
                    resolved_json TEXT,
                    manifest_json TEXT,
                    status TEXT NOT NULL,
                    progress INTEGER NOT NULL DEFAULT 0,
                    message TEXT,
                    error_code TEXT,
                    error_message TEXT,
                    summary_json TEXT,
                    result_artifact TEXT,
                    worker_pid INTEGER,
                    cancel_requested INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    started_at TEXT,
                    finished_at TEXT,
                    UNIQUE(user_id, idempotency_key)
                );
                CREATE INDEX IF NOT EXISTS runs_status_created_idx
                    ON runs(status, created_at);
                CREATE TABLE IF NOT EXISTS runtime_state (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                """
            )

    def create_or_get(self, request: RunRequest) -> tuple[dict[str, Any], bool]:
        now = utcnow()
        with self.immediate() as connection:
            existing = connection.execute(
                "SELECT * FROM runs WHERE user_id='local-user' AND idempotency_key=?",
                (request.idempotency_key,),
            ).fetchone()
            if existing:
                if existing["input_hash"] != request.input_hash:
                    raise IdempotencyConflict(
                        "This idempotency key was already used for different solver inputs."
                    )
                return dict(existing), True
            run_id = str(uuid.uuid4())
            connection.execute(
                """
                INSERT INTO runs (
                    id, project_id, project_name, idempotency_key, input_hash,
                    scenario_json, status, progress, message, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
                """,
                (
                    run_id,
                    request.project_id,
                    request.project_name,
                    request.idempotency_key,
                    request.input_hash,
                    request.scenario.model_dump_json(),
                    RunStatus.queued.value,
                    "Waiting for the solver worker.",
                    now,
                    now,
                ),
            )
            row = connection.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
            return dict(row), False

    def get(self, run_id: str) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
        return dict(row) if row else None

    def list_runs(self, project_id: str | None = None) -> list[dict[str, Any]]:
        with self.connect() as connection:
            if project_id:
                rows = connection.execute(
                    "SELECT * FROM runs WHERE project_id=? ORDER BY created_at DESC",
                    (project_id,),
                ).fetchall()
            else:
                rows = connection.execute("SELECT * FROM runs ORDER BY created_at DESC").fetchall()
        return [dict(row) for row in rows]

    def update(self, run_id: str, **changes: Any) -> dict[str, Any]:
        allowed = {
            "resolved_json", "manifest_json", "status", "progress", "message",
            "error_code", "error_message", "summary_json", "result_artifact",
            "worker_pid", "cancel_requested", "started_at", "finished_at",
        }
        unknown = set(changes) - allowed
        if unknown:
            raise ValueError(f"Unsupported run fields: {sorted(unknown)}")
        changes["updated_at"] = utcnow()
        assignments = ", ".join(f"{key}=?" for key in changes)
        values = list(changes.values()) + [run_id]
        with self.immediate() as connection:
            connection.execute(f"UPDATE runs SET {assignments} WHERE id=?", values)
            row = connection.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
        if row is None:
            raise KeyError(run_id)
        return dict(row)

    def claim_next(self) -> dict[str, Any] | None:
        now = utcnow()
        with self.immediate() as connection:
            row = connection.execute(
                "SELECT * FROM runs WHERE status=? ORDER BY created_at LIMIT 1",
                (RunStatus.queued.value,),
            ).fetchone()
            if row is None:
                return None
            connection.execute(
                """
                UPDATE runs SET status=?, progress=5, message=?, started_at=COALESCE(started_at, ?),
                    updated_at=?, worker_pid=NULL, cancel_requested=0 WHERE id=? AND status=?
                """,
                (
                    RunStatus.preparing.value,
                    "Preparing isolated solver inputs.",
                    now,
                    now,
                    row["id"],
                    RunStatus.queued.value,
                ),
            )
            claimed = connection.execute("SELECT * FROM runs WHERE id=?", (row["id"],)).fetchone()
            return dict(claimed)

    def request_cancel(self, run_id: str) -> dict[str, Any] | None:
        with self.immediate() as connection:
            row = connection.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
            if row is None:
                return None
            status = RunStatus(row["status"])
            if status is RunStatus.queued:
                now = utcnow()
                connection.execute(
                    """UPDATE runs SET status=?, progress=100, message=?, cancel_requested=1,
                       finished_at=?, updated_at=? WHERE id=?""",
                    (RunStatus.cancelled.value, "Run cancelled before it started.", now, now, run_id),
                )
            elif status in CANCELLABLE_STATUSES:
                connection.execute(
                    """UPDATE runs SET status=?, message=?, cancel_requested=1, updated_at=?
                       WHERE id=?""",
                    (RunStatus.cancelling.value, "Stopping the solver process.", utcnow(), run_id),
                )
            updated = connection.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
            return dict(updated)

    def is_cancel_requested(self, run_id: str) -> bool:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT cancel_requested FROM runs WHERE id=?", (run_id,)
            ).fetchone()
        return bool(row and row["cancel_requested"])

    def recover_interrupted(self) -> int:
        """Worker startup recovery: cancelling jobs finish cancelled; others requeue."""
        now = utcnow()
        with self.immediate() as connection:
            cancelling = connection.execute(
                """UPDATE runs SET status=?, progress=100, message=?, finished_at=?,
                   updated_at=?, worker_pid=NULL WHERE status=?""",
                (
                    RunStatus.cancelled.value,
                    "Cancellation completed during worker restart.",
                    now,
                    now,
                    RunStatus.cancelling.value,
                ),
            ).rowcount
            placeholders = ",".join("?" for _ in (
                RunStatus.preparing,
                RunStatus.validating,
                RunStatus.solving,
                RunStatus.processing_results,
            ))
            statuses = tuple(status.value for status in (
                RunStatus.preparing,
                RunStatus.validating,
                RunStatus.solving,
                RunStatus.processing_results,
            ))
            requeued = connection.execute(
                f"""UPDATE runs SET status=?, progress=0, message=?, updated_at=?, worker_pid=NULL
                    WHERE status IN ({placeholders})""",
                (RunStatus.queued.value, "Recovered after worker restart.", now, *statuses),
            ).rowcount
        return cancelling + requeued

    def heartbeat(self, worker_id: str) -> None:
        now = utcnow()
        with self.connect() as connection:
            connection.execute(
                """INSERT INTO runtime_state(key, value, updated_at) VALUES('worker', ?, ?)
                   ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at""",
                (worker_id, now),
            )

    def worker_state(self) -> tuple[str | None, datetime | None]:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT value, updated_at FROM runtime_state WHERE key='worker'"
            ).fetchone()
        if not row:
            return None, None
        return row["value"], datetime.fromisoformat(row["updated_at"])

    def queue_counts(self) -> tuple[int, int]:
        with self.connect() as connection:
            queued = connection.execute(
                "SELECT COUNT(*) FROM runs WHERE status=?", (RunStatus.queued.value,)
            ).fetchone()[0]
            placeholders = ",".join("?" for _ in ACTIVE_VALUES)
            active = connection.execute(
                f"SELECT COUNT(*) FROM runs WHERE status IN ({placeholders})",
                ACTIVE_VALUES,
            ).fetchone()[0]
        return int(queued), int(active)

    def database_ready(self) -> tuple[bool, str]:
        try:
            with self.connect() as connection:
                connection.execute("SELECT 1").fetchone()
            return True, "Persistent SQLite queue is writable (WAL mode)."
        except sqlite3.Error:
            return False, "Persistent run database is unavailable."

    @staticmethod
    def decode_json(row: dict[str, Any], field: str) -> Any:
        value = row.get(field)
        return json.loads(value) if value else None


def database_file(settings: Settings) -> Path:
    return settings.database_path
