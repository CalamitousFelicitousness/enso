"""What sdnext logged at warning level or above while a job ran."""

import logging
import threading

LIMIT = 20
MESSAGE_LIMIT = 500


class JobLogCapture(logging.Handler):
    """Collects the warnings and errors the creating thread logs."""

    def __init__(self):
        super().__init__(level=logging.WARNING)
        self.thread = threading.get_ident()
        self.entries: list[dict] = []

    def emit(self, record: logging.LogRecord) -> None:
        if record.thread != self.thread or len(self.entries) >= LIMIT:
            return
        level = "error" if record.levelno >= logging.ERROR else "warning"
        entry = {"level": level, "message": record.getMessage()[:MESSAGE_LIMIT]}
        if entry not in self.entries:
            self.entries.append(entry)

    def first_error(self) -> str | None:
        """Message of the first error logged, the cause sdnext gave for a failure."""
        return next((entry["message"] for entry in self.entries if entry["level"] == "error"), None)
