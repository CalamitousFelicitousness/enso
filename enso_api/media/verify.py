"""The verify pass: every held blob hashed again; a file whose bytes no longer match goes to corrupt/ and its row is marked lost."""

import json
import logging
import os
import threading
from collections.abc import Callable
from dataclasses import asdict, dataclass

from enso_api.media.collector import corrupt_path, signature
from enso_api.media.ingest import hash_file
from enso_api.media.layout import Layout
from enso_api.media.store import BlobRow, MediaStore

log = logging.getLogger("sd")

PAGE = 1000
PROGRESS_EVERY = 100


@dataclass
class Verified:
    at: int = 0
    checked: int = 0
    lost: int = 0
    corrupt: int = 0
    changed: int = 0  # replaced while it was hashed, by an ingest healing it
    cancelled: bool = False


def check(store: MediaStore, layout: Layout, row: BlobRow, result: Verified) -> None:
    path = store.path(row)
    try:
        before = signature(path)
        actual, _ = hash_file(path)
    except FileNotFoundError:
        result.lost += 1
        return
    except OSError as e:
        log.warning(f"Media store: {path} could not be read: {e}")
        result.lost += 1
        return
    if actual == row.hash:
        return
    with store.db.write() as w:
        # Moved only when it is the file that was hashed: an ingest may have put the right bytes back meanwhile
        try:
            if signature(path) != before:
                result.changed += 1
                return
        except FileNotFoundError:
            result.lost += 1
            return
        # The file goes first: a row left unmarked is found lost by the next pass, a file left in place would be served
        now = store.now()
        os.replace(path, corrupt_path(layout, f"{row.hash}.{row.ext}", now))
        w.conn.execute("UPDATE blobs SET lost_at = ? WHERE hash = ?", (now, row.hash))
        result.corrupt += 1


def run(store: MediaStore, layout: Layout, cancel: threading.Event, progress: Callable[[int, int], None]) -> Verified:
    result = Verified(at=store.now())
    with store.db.read() as conn:
        total = conn.execute("SELECT COUNT(*) FROM blobs WHERE lost_at IS NULL").fetchone()[0]
    progress(0, total)
    after = ""
    while not result.cancelled:
        with store.db.read() as conn:
            page = [BlobRow.from_row(row) for row in conn.execute("SELECT * FROM blobs WHERE hash > ? AND lost_at IS NULL ORDER BY hash LIMIT ?", (after, PAGE))]
        if not page:
            break
        after = page[-1].hash
        for row in page:
            if cancel.is_set():
                result.cancelled = True
                break
            check(store, layout, row, result)
            result.checked += 1
            if result.checked % PROGRESS_EVERY == 0:
                progress(result.checked, total)
    progress(result.checked, total)
    store.set_meta("last_verify", json.dumps(asdict(result)))
    log.info(f"Media store: verify checked={result.checked} of {total} corrupt={result.corrupt} lost={result.lost} changed={result.changed}{' cancelled' if result.cancelled else ''}")
    return result
