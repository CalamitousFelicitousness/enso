"""The media store's routes: the ingest, claims, adoptions, serving, its settings and its report."""

import asyncio
import errno
import logging
import os
import sqlite3

from fastapi import APIRouter, Depends, Path, Request, Response

from enso_api import events
from enso_api.media import boot
from enso_api.media.errors import refuse
from enso_api.media.ingest import Disconnected, ShortBody, Sink, Stalled, free_space, pump
from enso_api.media.models import (
    LastVerifyV2,
    MediaTermsV2,
    MediaTermV2,
    ReqAdoptV2,
    ReqClaimV2,
    ReqMediaSettingsV2,
    ResBlobV2,
    ResClaimV2,
    ResMediaReportV2,
    ResMediaSettingsV2,
    SettingBoundV2,
    SpaceV2,
    VerifyStateV2,
)
from enso_api.media.settings import BOUNDS, Settings
from enso_api.media.sniff import OCTET
from enso_api.media.store import BlobRow, MediaStore
from enso_api.routes import media_file
from enso_api.session import media_auth

log = logging.getLogger("sd")

STALL_SECONDS = 60.0
HASH_PATTERN = r"^[0-9a-f]{64}$"
IMMUTABLE = "private, max-age=31536000, immutable"
RAW_BODY = {"requestBody": {"required": True, "content": {"application/octet-stream": {"schema": {"type": "string", "format": "binary"}}}}}

router = APIRouter(prefix="/sdapi/v2", tags=["Media"])
# Loaded by <img>, <video> and downloads, which carry the session cookie instead of an Authorization header
serve_router = APIRouter(prefix="/sdapi/v2", tags=["Media"], dependencies=[Depends(media_auth)])


def store_or_503() -> MediaStore:
    store = boot.state.store
    if store is None:
        refuse(503, "media_store_off", f"Media store off: {boot.state.reason}")
    return store


def size_text(n: int) -> str:
    for unit in ("bytes", "KB", "MB", "GB"):
        if n < 1000:
            return f"{n:.0f} {unit}" if unit == "bytes" else f"{n:.1f} {unit}"
        n /= 1000
    return f"{n:.1f} TB"


def clean_name(name: str | None) -> str | None:
    base = os.path.basename((name or "").replace("\\", "/")).strip()
    return base[:255] or None


def blob_response(row: BlobRow, name: str | None, created: bool) -> ResBlobV2:
    return ResBlobV2(
        hash=row.hash,
        size=row.size,
        type=row.type,
        ext=row.ext,
        name=clean_name(name) or f"{row.hash}.{row.ext}",
        ref=f"upload:{row.hash}",
        url=f"/sdapi/v2/blobs/{row.hash}",
        created=created,
    )


def serve_blob(store: MediaStore, row: BlobRow, name: str | None):
    """Sniffed media inline with its type; anything else as an attachment no page can run."""
    inline = row.type != OCTET
    headers = {"Cache-Control": IMMUTABLE, "ETag": f'"{row.hash}"', "X-Content-Type-Options": "nosniff"}
    return media_file(store.path(row), clean_name(name) or f"{row.hash}.{row.ext}", "inline" if inline else "attachment", row.type if inline else OCTET, headers=headers)


def refuse_space(store: MediaStore, declared: int, reserve_bytes: int, free: int | None = None) -> None:
    space = store.inflight.space_for(declared, free_space(store.layout.root) if free is None else free, reserve_bytes)
    refuse(507, "insufficient_storage", f"Not enough free space: {size_text(space.free)} free, {size_text(space.needed)} needed with the reserve", free=space.free, needed=space.needed)


def refuse_failure(e: Exception, store: MediaStore, declared: int, reserve_bytes: int) -> None:
    """The refusal for an upload that failed on the way in; nothing for an error this does not know."""
    if isinstance(e, Stalled):
        refuse(408, "upload_stalled", f"No bytes arrived for {STALL_SECONDS:.0f} s")
    if isinstance(e, Disconnected):
        refuse(400, "short_body", f"The upload ended before its last byte ({e})")
    if isinstance(e, ShortBody):
        refuse(400, "short_body", f"The upload ended at {e.received} of {e.declared} bytes", received=e.received, declared=e.declared)
    # SQLite reports a full disk as its own error, not as ENOSPC
    if (isinstance(e, OSError) and e.errno == errno.ENOSPC) or (isinstance(e, sqlite3.OperationalError) and "full" in str(e)):
        refuse_space(store, declared, reserve_bytes)
    if isinstance(e, (OSError, sqlite3.Error)):
        refuse(500, "upload_failed", f"The upload could not be stored: {e}")


def declared_length(request: Request) -> int:
    try:
        declared = int(request.headers.get("content-length", "-1"))
    except ValueError:
        declared = -1
    if declared < 0:
        refuse(411, "length_required", "An upload needs a Content-Length header")
    if declared == 0:
        refuse(400, "empty_body", "The upload is empty")
    return declared


async def receive(request: Request, store: MediaStore, declared: int, transient: bool) -> tuple[BlobRow, bool]:
    """The body streamed into a part and taken into the store, refused before a byte lands when the disk cannot take it."""
    free, settings = await asyncio.to_thread(lambda: (free_space(store.layout.root), store.settings()))
    part = store.layout.new_part()
    token = store.inflight.reserve(declared, part, free, settings.reserve_bytes)
    if token is None:
        refuse_space(store, declared, settings.reserve_bytes, free)
    sink = None
    try:
        sink = await asyncio.to_thread(Sink, part)
        await pump(request.stream(), sink, declared, STALL_SECONDS)
        finished = await asyncio.to_thread(sink.close)
        return await asyncio.to_thread(store.place, finished, part, transient)
    except Exception as e:
        if sink is not None:
            await asyncio.to_thread(sink.abort)
        refuse_failure(e, store, declared, settings.reserve_bytes)
        raise
    except BaseException:
        if sink is not None:
            sink.abort()
        raise
    finally:
        store.inflight.release(token)


@router.post("/blobs", response_model=ResBlobV2, status_code=201, responses={200: {"model": ResBlobV2, "description": "The server already held these bytes"}}, openapi_extra=RAW_BODY)
async def post_blob(request: Request, response: Response, name: str | None = None, transient: bool = False):
    """Store the raw request body by its SHA-256: 201 for new bytes, 200 for bytes already held. Bytes nothing names
    go seven days after their last name went, one hour for `transient` bytes read once; every upload or claim of
    them keeps them for at least an hour more."""
    store = store_or_503()
    row, created = await receive(request, store, declared_length(request), transient)
    response.status_code = 201 if created else 200
    return blob_response(row, name, created)


@router.post("/blobs/claim", response_model=ResClaimV2)
async def post_claim(request: ReqClaimV2):
    """Which hashes the server holds, keeping those it does; `space` says whether `bytes` more fit."""
    store = store_or_503()

    def run():
        claim = store.claim(request.hashes)
        space = store.inflight.space_for(request.bytes, free_space(store.layout.root), store.settings().reserve_bytes)
        return claim, space

    claim, space = await asyncio.to_thread(run)
    return ResClaimV2(present=claim.present, missing=claim.missing, lost=claim.lost, space=SpaceV2(ok=space.ok, free=space.free, needed=space.needed))


@router.post("/blobs/adopt", response_model=ResBlobV2)
async def post_adopt(request: ReqAdoptV2):
    """Store an output the server holds, by its output id, without sending its bytes."""
    from enso_api.job_queue import job_queue

    store = store_or_503()

    def run() -> tuple[BlobRow, bool, str]:
        output = job_queue.store.resolve_output(request.output_id)
        path = output["path"] if output else None
        if not path or not os.path.isfile(path):
            refuse(404, "gone", "This output is no longer on the server")
        size = os.path.getsize(path)
        reserve_bytes = store.settings().reserve_bytes
        if not store.inflight.space_for(size, free_space(store.layout.root), reserve_bytes).ok:
            refuse_space(store, size, reserve_bytes)
        try:
            row, created = store.ingest_file(path)
        except FileNotFoundError:
            refuse(404, "gone", "This output is no longer on the server")
        except (OSError, sqlite3.Error) as e:
            refuse_failure(e, store, size, reserve_bytes)
            raise
        return row, created, os.path.basename(path)

    row, created, name = await asyncio.to_thread(run)
    return blob_response(row, name, created)


@serve_router.get("/blobs/{blob_hash}")
async def get_blob(blob_hash: str = Path(pattern=HASH_PATTERN), name: str | None = None):
    """A stored blob, cached for good: its bytes never change. Range requests are honored."""
    store = store_or_503()
    row = await asyncio.to_thread(store.get, blob_hash)
    if row is None:
        refuse(404, "gone", "This upload is no longer held")
    return serve_blob(store, row, name)


def settings_response(settings: Settings) -> ResMediaSettingsV2:
    bounds = {key: SettingBoundV2(low=bound.low, high=bound.high, default=bound.default) for key, bound in BOUNDS.items()}
    return ResMediaSettingsV2(**settings.as_dict(), bounds=bounds)


def caller_name(request: Request) -> str:
    from enso_api.session import auth_required, authenticate

    caller = authenticate(request.headers, request.cookies) if auth_required() else None
    return caller.user if caller is not None and caller.user else "anonymous"


@router.get("/media/settings", response_model=ResMediaSettingsV2)
async def get_media_settings():
    store = store_or_503()
    return settings_response(await asyncio.to_thread(store.settings))


@router.patch("/media/settings", response_model=ResMediaSettingsV2)
async def patch_media_settings(body: ReqMediaSettingsV2, request: Request):
    """Change the store's policy for every client; the collector applies it at its next pass."""
    from modules import shared

    store = store_or_503()
    if getattr(shared.cmd_opts, "freeze", False):
        refuse(403, "settings_frozen", "Settings are frozen on this server")
    patch = body.model_dump(exclude_unset=True)
    if not patch:
        return settings_response(await asyncio.to_thread(store.settings))
    settings = await asyncio.to_thread(store.update_settings, patch)
    log.info(f"Media store: settings {' '.join(f'{key}={value}' for key, value in patch.items())} by {caller_name(request)}")
    events.bump("settings", **settings.as_dict())
    return settings_response(settings)


def verify_state() -> VerifyStateV2:
    return VerifyStateV2()


@router.get("/media", response_model=ResMediaReportV2)
async def get_media_report():
    """What the store holds, by what keeps it, with the free space and the last collection and verify."""
    state = boot.state
    if state.store is None:
        return ResMediaReportV2(enabled=False, reason=state.reason, configured_root=state.configured_root, previous_root=state.previous_root)
    report = await asyncio.to_thread(state.store.report)
    return ResMediaReportV2(
        enabled=True,
        root=state.root,
        configured_root=state.configured_root,
        previous_root=state.previous_root,
        free=report.free,
        total=report.total,
        count=report.count,
        bytes=report.bytes,
        by_term=MediaTermsV2(**{name: MediaTermV2(count=term.count, bytes=term.bytes) for name, term in report.by_term.items()}),
        lost=report.lost,
        transient=report.transient,
        snapshots=MediaTermV2(count=report.snapshots.count, bytes=report.snapshots.bytes),
        corrupt=MediaTermV2(count=report.corrupt.count, bytes=report.corrupt.bytes),
        last_gc=report.last_gc,
        last_verify=LastVerifyV2(**report.last_verify) if report.last_verify else None,
        verify=verify_state(),
    )
