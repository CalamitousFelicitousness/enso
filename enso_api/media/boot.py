"""The media store at boot: its root, its database, the uploads earlier builds staged, and sdnext's resolver."""

import logging
import os
import sqlite3

from enso_api.media.collector import reconcile
from enso_api.media.entries import Entries
from enso_api.media.errors import MediaOff
from enso_api.media.layout import OPTION_LABEL, Layout, probe_folder, resolve_root
from enso_api.media.records import Records
from enso_api.media.schema import MIGRATIONS
from enso_api.media.store import MediaStore
from enso_api.sqlite import Database, NewerDatabase

log = logging.getLogger("sd")

FIX_SETTING = "fix the setting and restart"


class State:
    def __init__(self):
        self.store: MediaStore | None = None
        self.entries: Entries | None = None
        self.records: Records | None = None
        self.worker = None
        self.reason: str | None = None
        self.configured_root = ""
        self.previous_root: str | None = None

    @property
    def root(self) -> str | None:
        return self.store.layout.root if self.store is not None else None


state = State()


def require_store() -> MediaStore:
    """The store, else MediaOff with the reason; sdnext's upload resolver calls this as its getter."""
    if state.store is None:
        raise MediaOff(state.reason or "the store has not started")
    return state.store


def read_text(path: str) -> str | None:
    try:
        with open(path, encoding="utf-8") as f:
            return f.read().strip() or None
    except OSError:
        return None


def off(reason: str, uploads: str) -> None:
    state.reason = reason
    log.error(f"Media store off: {reason}")
    if os.path.isdir(uploads) and os.listdir(uploads):
        log.warning(f"Media store: {uploads} is kept; its uploads are taken in once the store starts")


def gallery_roots() -> list[str]:
    try:
        from enso_api.gallery import get_allowed_roots

        return sorted(get_allowed_roots())
    except Exception:
        return []


def init(data_dir: str) -> None:
    """Open the store before the queue starts, so the queue can name what its pending jobs use."""
    from modules import shared
    from modules.api.helpers import register_upload_store

    from enso_api.util import mark_dir_git_ignored

    register_upload_store(require_store)
    enso_data = os.path.join(data_dir, "data", "enso")
    uploads = os.path.join(enso_data, "uploads")
    marker_path = os.path.join(enso_data, "media-root")
    state.configured_root = str(getattr(shared.opts, "enso_media_root", "") or "")
    marker = read_text(marker_path)
    resolved = resolve_root(state.configured_root, data_dir, marker, probe_folder)
    if resolved.root is None:
        off(f"{resolved.reason}; {FIX_SETTING}", uploads)
        return
    layout = Layout(resolved.root)
    galleries = gallery_roots()
    # The Gallery leaves the root out, so a root holding a Gallery folder would hide that folder
    inside = next((root for root in galleries if layout.contains(root)), None)
    if inside is not None:
        off(f"{layout.root} set by '{OPTION_LABEL}' contains the Gallery folder {inside}; give the store a folder of its own and restart", uploads)
        return
    try:
        layout.make()
        if not layout.lock():
            off(f"{layout.root} is in use by another server; give each server its own '{OPTION_LABEL}' and restart", uploads)
            return
        db = Database(layout.db, MIGRATIONS, label="Media store", synchronous="NORMAL")
    except NewerDatabase as e:
        off(f"{e}; run a newer Enso or move the file aside", uploads)
        return
    except (OSError, sqlite3.Error) as e:
        off(f"{layout.root} could not be opened ({e}); {FIX_SETTING}", uploads)
        return
    mark_dir_git_ignored(layout.root)
    if resolved.previous:
        state.previous_root = resolved.previous
        log.warning(f"Media store: the root is now {layout.root}; the store at {resolved.previous} was not moved")
    if marker != layout.root:
        try:
            os.makedirs(enso_data, exist_ok=True)
            with open(marker_path, "w", encoding="utf-8") as f:
                f.write(layout.root + "\n")
        except OSError as e:
            log.warning(f"Media store: could not record the root in {marker_path}: {e}")
    store = MediaStore(layout, db)
    # Before the queue names its pending jobs' uploads: a row a power loss dropped is taken back in from its file first
    reconcile(store, layout, walk=True)
    taken = store.take_legacy_uploads(uploads)
    state.entries = Entries(db, store.held, store.settings, store.now)
    state.records = Records(db, store.held, store.resolve_ref, store.settings, store.now)
    state.store = store
    report = store.report()
    log.info(f"Media store: root={layout.root} blobs={report.count} size={report.bytes} lost={report.lost} free={report.free}{f' uploads taken in={taken}' if taken else ''}")
    holder = next((root for root in galleries if layout.real_root == root or layout.real_root.startswith(root + os.sep)), None)
    if holder is not None:
        log.info(f"Media store: {layout.root} is inside the Gallery folder {holder}, which leaves it out")


def start() -> None:
    """Start the store's thread after the queue, so its first pass knows which jobs are live."""
    if state.store is None or state.worker is not None:
        return
    from enso_api.job_queue import job_queue
    from enso_api.media import collector, verify
    from enso_api.media.worker import MediaWorker, publish_media

    store = state.store
    state.worker = MediaWorker(
        reconcile=lambda walk: collector.reconcile(store, store.layout, walk),
        collect=lambda: collector.run_pass(store, job_queue.live_jobs),
        verify=lambda cancel, progress: verify.run(store, store.layout, cancel, progress),
        on_progress=publish_media,
    )
    state.worker.start()
