"""The job a thread is running, for code its executor reaches."""

from contextvars import ContextVar

# Set and reset by the runners around each job: worker and pool threads are reused, and a pool task inherits nothing
active_job: ContextVar[str | None] = ContextVar("enso_active_job", default=None)
