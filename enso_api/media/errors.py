"""Refusals of the media routes: a code and a message a client can show, logged where sdnext's own line may not be."""

import logging
from typing import NoReturn

from fastapi import HTTPException

log = logging.getLogger("sd")


class MediaOff(Exception):
    """The store is off; the reason says what to fix."""

    def __init__(self, reason: str):
        super().__init__(f"Media store off: {reason}")
        self.reason = reason


def refuse(status: int, code: str, message: str, **fields) -> NoReturn:
    """Log and raise; sdnext logs an API error only when its log limiter lets the path through."""
    extra = "".join(f" {key}={value}" for key, value in fields.items())
    (log.warning if status >= 500 or status == 408 else log.info)(f"Media store: refused status={status} code={code}{extra}: {message}")
    raise HTTPException(status_code=status, detail={"code": code, "message": message, **fields})
