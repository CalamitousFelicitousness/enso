"""Requests an executor refuses before any work starts."""


class RequestRejected(ValueError):
    """Carries an HTTP-semantic code; the job queue logs it in one line, without a traceback."""

    code = 400

    @property
    def detail(self) -> str:
        """The job's error text: the message alone, without the class name."""
        return str(self)
