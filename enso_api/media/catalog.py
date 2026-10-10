"""The library, its trash and job records, with the submit that queues a job and its record in one request."""

import asyncio
import logging
import sqlite3
from collections.abc import Callable
from typing import Annotated, NoReturn, TypeVar

from fastapi import APIRouter, Path, Query, Request, Response

from enso_api import events
from enso_api.bounded import BoundedRoute
from enso_api.domains import domain_of
from enso_api.errors import refuse, refuse_issues
from enso_api.job_store import JobStore
from enso_api.media import boot
from enso_api.media.collector import free_now
from enso_api.media.entries import MAX_PINNED, Entries, EntryIn, EntryPatch, Gone, Refused
from enso_api.media.models import (
    ItemEntryV2,
    ItemRecordV2,
    PinsV2,
    ReqEmptyTrashV2,
    ReqEntryPatchV2,
    ReqEntryV2,
    ReqRecordPatchV2,
    ReqRecordPutV2,
    ReqSubmitV2,
    ResEntryChangeV2,
    ResEntryV2,
    ResFreedV2,
    ResLibraryV2,
    ResRecordsV2,
    ResRecordV2,
    ResTrashV2,
)
from enso_api.media.records import RecordIn, Records
from enso_api.media.store import MediaStore
from enso_api.media.worker import publish_media
from enso_api.models import JobResponse
from enso_api.session import authenticate

log = logging.getLogger("sd")

router = APIRouter(prefix="/sdapi/v2", tags=["Library"], route_class=BoundedRoute)

ENTRY_GONE = "No longer in the library"
RECORD_GONE = "Enso kept no record of this job"
T = TypeVar("T")


def catalog_or_503() -> tuple[MediaStore, Entries, Records]:
    state = boot.state
    if state.store is None or state.entries is None or state.records is None:
        refuse(503, "media_store_off", f"Media store off: {state.reason}")
    return state.store, state.entries, state.records


def user_of(request: Request) -> str | None:
    caller = authenticate(request.headers, request.cookies)
    return caller.user if caller is not None else None


def refused(e: Refused, label: str) -> NoReturn:
    if e.issues is not None:
        refuse_issues(e.issues, label)
    refuse(e.status, e.code, e.message, label=label, **e.fields)


async def run(fn: Callable[[], T], label: str, gone: str) -> T:
    """The work off the event loop, its refusals in the two error shapes."""
    try:
        return await asyncio.to_thread(fn)
    except Refused as e:
        refused(e, label)
    except Gone:
        refuse(404, "gone", gone, label=label)
    except sqlite3.OperationalError as e:
        # SQLite reports a full disk as its own error, not as ENOSPC
        if "full" not in str(e):
            raise
        refuse(507, "insufficient_storage", "The server's disk is full", label=label)


def entry_in(body: ReqEntryV2) -> EntryIn:
    summary = body.summary
    return EntryIn(
        id=body.id,
        kind=body.kind,
        name=body.name,
        saved_at=body.saved_at,
        used_at=body.used_at,
        pinned=body.pinned,
        trashed_at=body.trashed_at,
        frames=summary.frames,
        pictures=summary.pictures,
        role=summary.role,
        control=summary.control,
        width=summary.width,
        height=summary.height,
        inputs_schema=summary.inputs_schema,
        inputs=body.inputs,
        maps=body.maps,
        hashes=body.hashes,
        unavailable=body.unavailable,
        thumbs=[thumb.model_dump() for thumb in body.thumbs],
    )


def record_in(body) -> RecordIn:
    return RecordIn(
        client=body.client,
        checkpoint=body.checkpoint,
        refs=body.refs,
        inputs=body.inputs,
        map_keys=body.map_keys,
        maps=body.maps,
        hashes=body.hashes,
        unavailable=body.unavailable,
    )


def announce_entries(changed: list[str], trashed: list[str]) -> None:
    if changed:
        events.changed("library", changed)
    if trashed:
        events.changed("trash", trashed)


@router.post("/submit", response_model=JobResponse, status_code=202, responses={200: {"model": JobResponse, "description": "This submit_id queued its job before"}}, tags=["Jobs"])
async def post_submit(body: ReqSubmitV2, request: Request, response: Response):
    """Queue a job with its record. The record and the names of the job's uploads are written first, the job's row
    last; a refusal leaves neither. A repeated submit_id answers the job it queued."""
    from enso_api.executors import EXECUTORS
    from enso_api.job_queue import job_queue
    from enso_api.routes import job_to_response

    _, _, records = catalog_or_503()
    payload = body.job.model_dump(exclude_unset=True)
    job_type = payload["type"]
    domain = domain_of(job_type)
    if domain is None:
        refuse(422, "untracked_type", f"Enso keeps no record of {job_type} jobs; send them to /sdapi/v2/jobs", label="Jobs")
    if job_type not in EXECUTORS:
        refuse(500, "no_executor", f"Job type {job_type!r} has no registered executor", label="Jobs")
    priority = payload.pop("priority", 0)
    job_id = JobStore.new_id()
    record = record_in(body.record)
    user = user_of(request)

    def submit():
        return records.submit_with_record(
            job_id,
            body.submit_id,
            record,
            payload,
            domain,
            user,
            enqueue=lambda queued: job_queue.enqueue(job_type, payload, priority, queued),
            lookup=job_queue.store.get,
        )

    submitted = await run(submit, "Jobs", RECORD_GONE)
    if submitted.created:
        events.changed("records", [submitted.job["id"]])
    response.status_code = 202 if submitted.created else 200
    return job_to_response(submitted.job)


@router.get("/library", response_model=ResLibraryV2)
async def get_library(ids: Annotated[list[str] | None, Query(max_length=200)] = None):
    """The library, pinned entries first then by last use; with ids, those entries whatever their state."""
    store, entries, _ = catalog_or_503()

    def read():
        return entries.list(False, ids), entries.counts()[0], store.settings()

    listed, pinned, settings = await run(read, "Media store", ENTRY_GONE)
    return ResLibraryV2(entries=[ItemEntryV2(**entry) for entry in listed], cap=settings.library_cap, pins=PinsV2(count=pinned, max=MAX_PINNED), days=settings.trash_days)


@router.get("/library/trash", response_model=ResTrashV2)
async def get_trash():
    """Trashed entries, newest first, with who trashed them and why, and the bytes deleting them all frees."""
    store, entries, _ = catalog_or_503()

    def read():
        return entries.list(True), entries.reclaimable(), store.settings()

    listed, reclaimable, settings = await run(read, "Media store", ENTRY_GONE)
    return ResTrashV2(entries=[ItemEntryV2(**entry) for entry in listed], reclaimable=reclaimable, days=settings.trash_days)


@router.post("/library/trash/empty", response_model=ResFreedV2)
async def post_empty_trash(body: ReqEmptyTrashV2):
    """Delete the trashed entries listed; an id not in the trash is skipped."""
    store, entries, _ = catalog_or_503()

    def delete():
        deleted = entries.delete(body.ids)
        return deleted, free_now(store, deleted.hashes)

    deleted, freed = await run(delete, "Media store", ENTRY_GONE)
    if deleted.ids:
        events.changed("trash", deleted.ids)
        publish_media()
    log.info(f"Media store: trash emptied entries={len(deleted.ids)} of {len(body.ids)} freed={freed}")
    return ResFreedV2(deleted=deleted.ids, freed=freed)


@router.post("/library", response_model=ResEntryChangeV2, status_code=201, responses={200: {"model": ResEntryChangeV2, "description": "An entry with this id is stored already"}})
async def post_library(body: ReqEntryV2, request: Request, response: Response):
    """Save an entry; the least recently used unpinned entries past the cap move to the trash. Every picture, map
    and thumbnail it names must be uploaded first."""
    _, entries, _ = catalog_or_503()
    user = user_of(request)
    changed = await run(lambda: entries.save(entry_in(body), user, body.migrating), "Media store", ENTRY_GONE)
    pushed = [entry["id"] for entry in changed.pushed_out]
    if changed.created:
        announce_entries([body.id, *pushed], pushed)
    response.status_code = 201 if changed.created else 200
    return ResEntryChangeV2(entry=ItemEntryV2(**changed.entry), pushed_out=changed.pushed_out, unpinned=changed.unpinned, created=changed.created)


@router.get("/library/{entry_id}", response_model=ResEntryV2)
async def get_library_entry(entry_id: str = Path(max_length=64)):
    """An entry with its document; a trashed entry reads too."""
    _, entries, _ = catalog_or_503()
    entry = await run(lambda: entries.get(entry_id), "Media store", ENTRY_GONE)
    if entry is None:
        refuse(404, "gone", ENTRY_GONE)
    return ResEntryV2(**entry)


@router.patch("/library/{entry_id}", response_model=ResEntryChangeV2)
async def patch_library_entry(body: ReqEntryPatchV2, request: Request, entry_id: str = Path(max_length=64)):
    """Rename, pin, mark used, trash or bring back; an entry brought back or unpinned counts toward the cap again."""
    _, entries, _ = catalog_or_503()
    change = EntryPatch(name=body.name, pinned=body.pinned, used=bool(body.used), trashed=body.trashed)
    user = user_of(request)
    changed = await run(lambda: entries.patch(entry_id, change, user), "Media store", ENTRY_GONE)
    pushed = [entry["id"] for entry in changed.pushed_out]
    announce_entries([entry_id, *pushed], [entry_id] * changed.trash_moved + pushed)
    return ResEntryChangeV2(entry=ItemEntryV2(**changed.entry), pushed_out=changed.pushed_out, unpinned=changed.unpinned, created=False)


@router.delete("/library/{entry_id}", response_model=ResFreedV2)
async def delete_library_entry(entry_id: str = Path(max_length=64)):
    """Delete an entry from the trash for good."""
    store, entries, _ = catalog_or_503()

    def delete():
        found = entries.list(False, [entry_id])
        if not found:
            raise Gone(entry_id)
        if found[0]["trashed_at"] is None:
            raise Refused(409, "not_trashed", "Only an entry in the trash can be deleted")
        deleted = entries.delete([entry_id])
        return deleted, free_now(store, deleted.hashes)

    deleted, freed = await run(delete, "Media store", ENTRY_GONE)
    if deleted.ids:
        events.changed("trash", deleted.ids)
        publish_media()
    return ResFreedV2(deleted=deleted.ids, freed=freed)


@router.put("/records/{job_id}", response_model=ItemRecordV2, status_code=201, responses={200: {"model": ItemRecordV2, "description": "A record of this job is stored already"}})
async def put_record(body: ReqRecordPutV2, request: Request, response: Response, job_id: str = Path(max_length=64)):
    """Store the record of a job that already ran, as a browser moves its records; a ref the server does not hold
    is kept and counted, never refused."""
    _, _, records = catalog_or_503()
    user = user_of(request)
    item, created = await run(lambda: records.put(job_id, record_in(body), body.request, body.domain, body.created_at, body.routed, user), "Media store", RECORD_GONE)
    if created:
        events.changed("records", [job_id])
    response.status_code = 201 if created else 200
    return ItemRecordV2(**item)


@router.get("/records", response_model=ResRecordsV2)
async def get_records(client: str | None = Query(default=None, max_length=64), routed: bool | None = None, ids: Annotated[list[str] | None, Query(max_length=200)] = None):
    """Records by the browser that keeps them or by job ids, newest first; one of the two is required."""
    _, _, records = catalog_or_503()
    if client is None and ids is None:
        refuse_issues([{"loc": ["query", "client"], "msg": "List records by client or by ids", "type": "missing_filter", "input": None}], "Media store")
    listed = await run(lambda: records.list(client, routed, ids), "Media store", RECORD_GONE)
    return ResRecordsV2(records=[ItemRecordV2(**item) for item in listed])


@router.get("/records/{job_id}", response_model=ResRecordV2)
async def get_record(job_id: str = Path(max_length=64)):
    """A record with its document, the cids whose bytes are lost and the refs that cannot be sent again as they are."""
    _, _, records = catalog_or_503()
    record = await run(lambda: records.get(job_id), "Media store", RECORD_GONE)
    if record is None:
        refuse(404, "gone", RECORD_GONE)
    return ResRecordV2(**record)


@router.patch("/records/{job_id}", response_model=ItemRecordV2)
async def patch_record(body: ReqRecordPatchV2, job_id: str = Path(max_length=64)):  # pylint: disable=unused-argument
    """Mark a record routed: its result reached a strip, or never will."""
    _, _, records = catalog_or_503()
    item = await run(lambda: records.route(job_id), "Media store", RECORD_GONE)
    events.changed("records", [job_id])
    return ItemRecordV2(**item)
