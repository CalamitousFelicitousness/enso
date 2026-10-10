"""Refusals of Enso's routes: a code and a message a client can show, logged where sdnext's own line may not be."""

import logging
from collections import Counter
from typing import NoReturn

from fastapi import HTTPException

log = logging.getLogger("sd")


def refuse(status: int, code: str, message: str, label: str = "Media store", **fields) -> NoReturn:
    """Log and raise; sdnext logs an API error only when its log limiter lets the path through."""
    extra = "".join(f" {key}={value}" for key, value in fields.items())
    (log.warning if status >= 500 or status == 408 else log.info)(f"{label}: refused status={status} code={code}{extra}: {message}")
    raise HTTPException(status_code=status, detail={"code": code, "message": message, **fields})


def refuse_issues(issues: list[dict], label: str) -> NoReturn:
    """A 422 with FastAPI's issue list, logged with how many of each type."""
    kinds = Counter(item["type"] for item in issues)
    log.info(f"{label}: refused status=422 {' '.join(f'{kind}={count}' for kind, count in sorted(kinds.items()))}")
    raise HTTPException(status_code=422, detail=issues)
