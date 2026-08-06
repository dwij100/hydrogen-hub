"""Docker health check for the persistent worker."""

from datetime import datetime, timezone

from .config import get_settings
from .database import RunStore


def main() -> int:
    settings = get_settings()
    _, heartbeat = RunStore(settings).worker_state()
    if heartbeat is None:
        return 1
    age = (datetime.now(timezone.utc) - heartbeat).total_seconds()
    return 0 if age <= settings.worker_stale_seconds else 1


if __name__ == "__main__":
    raise SystemExit(main())
