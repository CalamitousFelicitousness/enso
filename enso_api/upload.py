import asyncio

from fastapi import APIRouter, Depends, Path, Request
from pydantic import BaseModel
from starlette.datastructures import UploadFile

from enso_api.documents import MISSING, REF_PREFIX, ref_issues
from enso_api.session import media_auth


def missing_upload_issues(job_type: str, params: dict, missing: set[str]) -> list[dict]:
    """An upload_missing issue at each place a job's request names one of the missing upload ids."""
    from enso_api.media import boot

    message = MISSING if boot.state.store is not None else f"Media store off: {boot.state.reason}"
    return ref_issues(params, missing, ("body", job_type), message)


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
