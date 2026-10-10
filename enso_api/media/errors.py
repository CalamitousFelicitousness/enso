"""The store's own failure, with what to fix."""


class MediaOff(Exception):
    """The store is off; the reason says what to fix."""

    def __init__(self, reason: str):
        super().__init__(f"Media store off: {reason}")
        self.reason = reason
