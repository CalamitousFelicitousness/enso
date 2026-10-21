"""Recipe files: export an entry or the current state, serve the packed file, and import one into the library."""

import asyncio
import contextlib
import logging
import os
import threading
import uuid

from fastapi import APIRouter, Depends, Path, Request, Response

from enso_api.bounded import BoundedRoute
from enso_api.errors import refuse, refuse_issues
from enso_api.media.catalog import ENTRY_GONE, announce_entries, catalog_or_503, run, user_of
from enso_api.media.ingest import Sink, free_space, pump
from enso_api.media.models import ItemEntryV2
from enso_api.media.routes import RAW_BODY, STALL_SECONDS, clean_name, declared_length, refuse_failure, refuse_space
from enso_api.recipes import pack, transfer
from enso_api.recipes.identity import local_recipe
from enso_api.recipes.models import MIME, ExistingEntryV2, ImportedBlobsV2, ReqExportBodyV2, ReqExportEntryV2, ResExportV2, ResImportV2
from enso_api.routes import media_file
from enso_api.session import media_auth

log = logging.getLogger("sd")

LABEL = "Recipes"

router = APIRouter(prefix="/sdapi/v2", tags=["Library"], route_class=BoundedRoute)
# The packed file is fetched by a download, which carries the session cookie instead of an Authorization header
serve_router = APIRouter(prefix="/sdapi/v2", tags=["Library"], dependencies=[Depends(media_auth)])


def enso_version() -> str:
    from enso_api.server import extension_commit

    return extension_commit() or "unknown"


async def watch(request: Request, gone: threading.Event) -> None:
    """Set `gone` when the client leaves. Request.is_disconnected never sees it through sdnext's http middleware, whose
    receive it polls in a cancelled scope; awaiting the next message does."""
    while (await request.receive())["type"] != "http.disconnect":
        pass
    gone.set()


async def transfer_run(fn, store, declared: int):
    """A transfer off the event loop, its refusals as coded answers."""
    try:
        return await run(fn, LABEL, ENTRY_GONE)
    except pack.Refusal as e:
        refuse(e.status, e.code, e.message, label=LABEL, **e.fields)
    except OSError as e:
        refuse_failure(e, store, declared, store.settings().reserve_bytes)
        raise


@router.post("/export", response_model=ResExportV2)
async def post_export(body: ReqExportEntryV2 | ReqExportBodyV2, request: Request):
    """Pack an entry, or the current inputs and settings, into a recipe file; GET /export/{id} serves it for an hour.
    Every picture it names must be held."""
    store, entries, _ = catalog_or_503()
    if isinstance(body, ReqExportEntryV2):
        entry, manifest_id = await run(lambda: transfer.stored_entry(entries, body.entry_id), LABEL, ENTRY_GONE)
    else:
        recipe = await asyncio.to_thread(local_recipe, body.recipe.model_dump()) if body.recipe is not None else None
        entry, issues = transfer.body_entry(body, recipe)
        if entry is None:
            refuse_issues(issues, LABEL)
        manifest_id = uuid.uuid4().hex
    gone = threading.Event()
    watcher = asyncio.create_task(watch(request, gone))
    try:
        packed = await transfer_run(lambda: transfer.pack_entry(store, entry, manifest_id, enso_version(), gone.is_set), store, 0)
    finally:
        watcher.cancel()
    log.info(f"{LABEL}: exported kind={entry['kind']} blobs={packed.blobs} size={packed.bytes} id={packed.id}")
    return ResExportV2(id=packed.id, name=packed.name, bytes=packed.bytes, blobs=packed.blobs)


@serve_router.get("/export/{export_id}")
async def get_export(export_id: str = Path(pattern=r"^[0-9a-f]{32}$"), name: str | None = None):
    """A packed recipe file, for an hour after it was packed."""
    store, _, _ = catalog_or_503()
    path = store.layout.export_path(export_id)
    if not await asyncio.to_thread(os.path.isfile, path):
        refuse(404, "gone", "This export is no longer kept; export again", label=LABEL)
    filename = pack.file_name(os.path.splitext(clean_name(name) or "recipe")[0])
    return media_file(path, filename, "attachment", MIME, headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})


@router.post("/import", response_model=ResImportV2, status_code=201, responses={200: {"model": ResImportV2, "description": "The library already holds this entry"}}, openapi_extra=RAW_BODY)
async def post_import(request: Request, response: Response):
    """Import a recipe file into the library. Every picture in it is hashed as it lands and must be the one its name
    gives; nothing is kept from a file that is refused."""
    store, entries, _ = catalog_or_503()
    declared = declared_length(request)
    user = user_of(request)
    free, settings = await asyncio.to_thread(lambda: (free_space(store.layout.root), store.settings()))
    part = store.layout.new_part()
    token = store.inflight.reserve(declared, part, free, settings.reserve_bytes)
    if token is None:
        refuse_space(store, declared, settings.reserve_bytes, free)
    sink = None
    try:
        sink = await asyncio.to_thread(Sink, part)
        try:
            await pump(request.stream(), sink, declared, STALL_SECONDS)
            await asyncio.to_thread(sink.close)
        except Exception as e:
            await asyncio.to_thread(sink.abort)
            refuse_failure(e, store, declared, settings.reserve_bytes)
            raise
        imported = await transfer_run(lambda: transfer.unpack_entry(store, entries, part, user), store, declared)
    finally:
        store.inflight.release(token)
        with contextlib.suppress(OSError):
            os.remove(part)
    if imported.created:
        pushed = [item["id"] for item in imported.pushed_out]
        announce_entries([imported.entry["id"], *pushed], pushed)
    log.info(f"{LABEL}: imported id={imported.entry['id']} created={imported.created} blobs added={imported.added} held={imported.held}")
    response.status_code = 201 if imported.created else 200
    existing = imported.existing
    return ResImportV2(
        entry=ItemEntryV2(**imported.entry),
        created=imported.created,
        existing=ExistingEntryV2(id=existing["id"], name=existing["name"]) if existing else None,
        pushed_out=imported.pushed_out,
        blobs=ImportedBlobsV2(added=imported.added, held=imported.held),
        unavailable=imported.unavailable,
    )
