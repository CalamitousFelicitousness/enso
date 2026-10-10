import asyncio

from fastapi import APIRouter, Depends, Path, Request
from pydantic import BaseModel
from starlette.datastructures import UploadFile

from enso_api.session import media_auth

REF_PREFIX = "upload:"


def refs_in(value) -> set[str]:
    """Upload ref ids named anywhere in a request."""
    if isinstance(value, str):
        return {value[len(REF_PREFIX) :]} if value.startswith(REF_PREFIX) else set()
    if isinstance(value, dict):
        value = list(value.values())
    if isinstance(value, list) and value:
        return set().union(*(refs_in(item) for item in value))
    return set()


def ref_locations(value, path: tuple = ()) -> list[tuple[tuple, str]]:
    """Every upload ref named in a request, with the path to it."""
    if isinstance(value, str):
        return [(path, value[len(REF_PREFIX) :])] if value.startswith(REF_PREFIX) else []
    if isinstance(value, dict):
        return [loc for key, item in value.items() for loc in ref_locations(item, (*path, key))]
    if isinstance(value, list):
        return [loc for i, item in enumerate(value) for loc in ref_locations(item, (*path, i))]
    return []


def missing_upload_issues(job_type: str, params: dict, missing: set[str]) -> list[dict]:
    """A validation issue for each place a request names one of the missing upload ids, in FastAPI's 422
    shape; type `upload_missing` is the stable code."""
    from enso_api.media import boot

    message = "This upload is no longer held; send the picture again" if boot.state.store is not None else f"Media store off: {boot.state.reason}"
    return [
        {
            "loc": ["body", job_type, *path],
            "msg": message,
            "type": "upload_missing",
            "input": f"{REF_PREFIX}{ref_id}",
        }
        for path, ref_id in ref_locations(params)
        if ref_id in missing
    ]


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
    from enso_api.media.ingest import BATCH, free_space
    from enso_api.media.routes import declared_length, refuse_failure, refuse_space, store_or_503

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
    from enso_api.media.errors import refuse
    from enso_api.media.routes import serve_blob, store_or_503

    store = store_or_503()

    def find():
        digest = store.resolve_ref(ref_id)
        return store.get(digest) if digest else None

    row = await asyncio.to_thread(find)
    if row is None:
        refuse(404, "gone", "This upload is no longer held")
    return serve_blob(store, row, name)
