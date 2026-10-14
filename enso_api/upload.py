import asyncio

from fastapi import APIRouter, Depends, Path, Request
from pydantic import BaseModel
from starlette.datastructures import UploadFile

from enso_api.documents import MISSING, REF_PREFIX, ref_issues
from enso_api.inputs import InputTooLarge, input_issues, size_of_inline
from enso_api.session import media_auth


def missing_upload_issues(job_type: str, params: dict, missing: set[str]) -> list[dict]:
    """An upload_missing issue at each place a job's request names one of the missing upload ids."""
    from enso_api.media import boot

    message = MISSING if boot.state.store is not None else f"Media store off: {boot.state.reason}"
    return ref_issues(params, missing, ("body", job_type), message)


def input_limit() -> tuple[int, object]:
    """The server's input limit and the store that knows each ref's size; the default limit while the store is off."""
    from enso_api.media import boot
    from enso_api.media.settings import BOUNDS

    store = boot.state.store
    return (store.settings().max_input_pixels if store is not None else BOUNDS["max_input_pixels"].default), store


def oversize_issues(params: dict, loc: tuple) -> list[dict]:
    """An input_too_large issue at each place a request names a picture above the server's input limit."""
    limit, store = input_limit()
    return input_issues(params, store.size_of_ref if store is not None else lambda ref: None, limit, loc)


def check_input_size(value) -> None:
    """InputTooLarge for an upload ref or a base64 picture above the server's input limit."""
    if not isinstance(value, str) or not value:
        return
    limit, store = input_limit()
    if value.startswith(REF_PREFIX):
        size = store.size_of_ref(value[len(REF_PREFIX) :]) if store is not None else None
    else:
        found = size_of_inline(value, limit)
        size = (found.width, found.height) if found else None
    if size is not None and size[0] * size[1] > limit:
        raise InputTooLarge(size[0], size[1], limit)


def refuse_oversize(value, label: str) -> None:
    """A 422 too_large for a picture above the server's input limit, for a route that decodes one itself."""
    from enso_api.errors import refuse

    try:
        check_input_size(value)
    except InputTooLarge as e:
        refuse(422, "too_large", str(e), label=label, width=e.width, height=e.height, pixels=e.width * e.height, limit=e.limit)


class UploadRef(BaseModel):
    ref: str
    name: str
    size: int
    url: str


class UploadResponse(BaseModel):
    uploads: list[UploadRef]


upload_router = APIRouter(prefix="/sdapi/v2", tags=["Upload"])
upload_media_router = APIRouter(prefix="/sdapi/v2", tags=["Upload"], dependencies=[Depends(media_auth)])

MULTIPART_BODY = {
    "requestBody": {
        "required": True,
        "content": {"multipart/form-data": {"schema": {"type": "object", "properties": {"files": {"type": "array", "items": {"type": "string", "format": "binary"}}}, "required": ["files"]}}},
    }
}


@upload_router.post("/upload", response_model=UploadResponse, deprecated=True, openapi_extra=MULTIPART_BODY)
async def upload_files(request: Request):
    """Store multipart `files` in the media store, for a page from before POST /blobs; the refs name the stored hashes."""
    from enso_api.inputs import size_of_file
    from enso_api.media.ingest import BATCH, free_space
    from enso_api.media.routes import declared_length, refuse_failure, refuse_space, refuse_too_large, store_or_503

    store = store_or_503()
    declared = declared_length(request)
    free, settings = await asyncio.to_thread(lambda: (free_space(store.layout.root), store.settings()))
    # Checked before the form is read: Starlette spools the whole body first
    token = store.inflight.reserve(declared, f"multipart-{id(request)}", free, settings.reserve_bytes)
    if token is None:
        refuse_space(store, declared, settings.reserve_bytes, free)
    refs: list[UploadRef] = []
    try:
        async with request.form() as form:
            for item in form.getlist("files"):
                if not isinstance(item, UploadFile):
                    continue
                source = item.file
                found = await asyncio.to_thread(size_of_file, source, settings.max_input_pixels)
                if found is not None and found.pixels > settings.max_input_pixels:
                    refuse_too_large(InputTooLarge(found.width, found.height, settings.max_input_pixels))
                try:
                    row, _ = await asyncio.to_thread(store.ingest_chunks, iter(lambda source=source: source.read(BATCH), b""), item.size or 0)
                except OSError as e:
                    refuse_failure(e, store, item.size or 0, settings.reserve_bytes)
                    raise
                refs.append(UploadRef(ref=f"{REF_PREFIX}{row.hash}", name=item.filename or f"{row.hash}.{row.ext}", size=row.size, url=f"/sdapi/v2/blobs/{row.hash}"))
    finally:
        store.inflight.release(token)
    return UploadResponse(uploads=refs)


@upload_media_router.get("/uploads/{ref_id}", deprecated=True)
async def get_upload(ref_id: str = Path(pattern=r"^([0-9a-f]{16}|[0-9a-f]{64})$"), name: str | None = None):
    """An upload by the id in its ref: a hash, or the id an earlier build gave it."""
    from enso_api.errors import refuse
    from enso_api.media.routes import serve_blob, store_or_503

    store = store_or_503()

    def find():
        digest = store.resolve_ref(ref_id)
        return store.get(digest) if digest else None

    row = await asyncio.to_thread(find)
    if row is None:
        refuse(404, "gone", "This upload is no longer held")
    return serve_blob(store, row, name)
