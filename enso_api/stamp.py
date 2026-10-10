"""The job id in the metadata of every output a job saves, and reading it back.

sdnext's infotext.parse reads the prompt as everything before its first stop key and, when there is none and the
text holds a pair, as empty: a stamp is only appended to a text that already parses to a pair.
"""

import logging
import re
from collections.abc import Callable, Iterable

from enso_api.job_context import active_job

log = logging.getLogger("sd")

STAMP_KEY = "Enso job"
STAMP_PREFIX = "enso-"
STAMPED_SECTIONS = ("parameters", "extras")
# infotext.parse finds a pair wherever a key of word characters and spaces meets a colon, since its value pattern
# matches any text; its own pattern backtracks exponentially on an unclosed quote, so it is not reused here
KEY_RE = re.compile(r"[\w ]:")
TRAILING_RE = re.compile(r"(?:^|,)\s*Enso job:\s*enso-([0-9a-f]+)\s*$")


def strip_stamp(text: str) -> str:
    """The text without a trailing stamp; a stamp anywhere else, as in an infotext pasted into a prompt, stays."""
    return TRAILING_RE.sub("", text)


def stamped(text: str, job_id: str) -> str:
    """The text with this job's stamp as its last pair; a text without a pair only loses an old stamp."""
    base = strip_stamp(text)
    if not KEY_RE.search(base):
        return base
    return f"{base.rstrip().rstrip(',')}, {STAMP_KEY}: {STAMP_PREFIX}{job_id}"


def stamp_in(text: str | None) -> str | None:
    """The job id of the stamp that ends a text, where the callback writes it."""
    match = TRAILING_RE.search(text or "")
    return match.group(1) if match else None


def thumb_job(texts: Iterable[str | None], lookup: Callable[[], str | None]) -> tuple[str | None, str | None]:
    """The job that made a file and how it is known: a stamp in one of its texts, which travels with the file, else the outputs table."""
    for text in texts:
        found = stamp_in(text)
        if found is not None:
            return found, "stamp"
    found = lookup()
    return (found, "table") if found is not None else (None, None)


def on_before_image_saved(params) -> None:
    """sdnext's before_image_saved callback: the save's sections stamped while a job runs on this thread."""
    job_id = active_job.get()
    if job_id is None:
        return
    try:
        pnginfo = params.pnginfo
        for key, value in list(pnginfo.items()):
            if isinstance(value, str):
                pnginfo[key] = stamped(value, job_id) if key in STAMPED_SECTIONS else strip_stamp(value)
    except Exception as e:
        # A warning would reach the job's own warnings through its log capture
        log.debug(f"Enso: job {job_id} not stamped into a save: {type(e).__name__}: {e}")


def register() -> None:
    from modules import script_callbacks

    script_callbacks.on_before_image_saved(on_before_image_saved)
