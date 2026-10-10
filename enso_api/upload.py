import contextlib
import os
import re
import threading
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse
from modules.logger import log
from PIL import Image
from pydantic import BaseModel

from enso_api.session import media_auth

REF_PREFIX = "upload:"
FILE_PATTERN = re.compile(r"^([0-9a-f]{16})\.[A-Za-z0-9]+$")


class UploadEntry:
    __slots__ = ("content_type", "created", "name", "path", "ref_id", "size")

    def __init__(self, ref_id: str, path: str, name: str, size: int, content_type: str, created: float | None = None):
        self.ref_id = ref_id
        self.path = path
        self.name = name
        self.size = size
        self.content_type = content_type
        self.created = time.time() if created is None else created


class UploadInUse(Exception):
    """A job that has not finished names the upload."""


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


def missing_upload_issues(job_type: str, params: dict) -> list[dict]:
    """A validation issue for each upload a request names that the store no longer holds,
    in FastAPI's 422 shape; type `upload_missing` is the stable code."""
    if upload_store is None:
        return []
    return [
        {
            "loc": ["body", job_type, *path],
            "msg": "This upload is no longer held; send the picture again",
            "type": "upload_missing",
            "input": f"{REF_PREFIX}{ref_id}",
        }
        for path, ref_id in ref_locations(params)
        if upload_store.get(ref_id) is None
    ]


class UploadStore:
    """Uploaded files by ref id; the refs a queued or running job names outlive the TTL."""

    def __init__(self, staging_dir: str, ttl: int = 1800):
        self.staging_dir = staging_dir
        self.ttl = ttl
        self.entries: dict[str, UploadEntry] = {}
        self.pins: dict[str, set[str]] = {}
        self.lock = threading.Lock()
        os.makedirs(staging_dir, exist_ok=True)

    def reindex(self) -> int:
        """Take in the files an earlier process left, dated by modification time."""
        found = 0
        for name in sorted(os.listdir(self.staging_dir)):
            match = FILE_PATTERN.match(name)
            path = os.path.join(self.staging_dir, name)
            if not match or not os.path.isfile(path):
                continue
            with open(path, "rb") as f:
                head = f.read(12)
            entry = UploadEntry(match.group(1), path, name, os.path.getsize(path), detect_image_type(head) or "application/octet-stream", created=os.path.getmtime(path))
            with self.lock:
                self.entries.setdefault(entry.ref_id, entry)
            found += 1
        return found

    def store(self, data: bytes, original_name: str, content_type: str) -> UploadEntry:
        ref_id = uuid.uuid4().hex[:16]
        ext = os.path.splitext(original_name)[1] or ".png"
        path = os.path.join(self.staging_dir, f"{ref_id}{ext}")
        with open(path, "wb") as f:
            f.write(data)
        entry = UploadEntry(ref_id=ref_id, path=path, name=original_name, size=len(data), content_type=content_type)
        with self.lock:
            self.entries[ref_id] = entry
        return entry

    def get(self, ref_id: str) -> UploadEntry | None:
        with self.lock:
            entry = self.entries.get(ref_id)
        if entry and os.path.isfile(entry.path):
            return entry
        return None

    def pin(self, job_id: str, refs: set[str]) -> None:
        """Hold these refs until the job is released."""
        if refs:
            with self.lock:
                self.pins.setdefault(job_id, set()).update(refs)

    def release(self, job_id: str) -> None:
        with self.lock:
            self.pins.pop(job_id, None)

    def release_except(self, live: set[str]) -> int:
        """Drop the pins of every job not in live, whichever way it ended; the count dropped."""
        with self.lock:
            gone = [job_id for job_id in self.pins if job_id not in live]
            for job_id in gone:
                del self.pins[job_id]
        return len(gone)

    def pinned_by(self, ref_id: str) -> list[str]:
        with self.lock:
            return sorted(job_id for job_id, refs in self.pins.items() if ref_id in refs)

    def resolve_to_image(self, ref_id: str) -> Image.Image | None:
        entry = self.get(ref_id)
        if entry is None:
            return None
        return Image.open(entry.path)

    def resolve_to_path(self, ref_id: str) -> str | None:
        entry = self.get(ref_id)
        return entry.path if entry else None

    def remove(self, ref_id: str) -> None:
        """Delete an upload; refused while a job names it."""
        jobs = self.pinned_by(ref_id)
        if jobs:
            raise UploadInUse(f"named by job {', '.join(jobs)}")
        with self.lock:
            entry = self.entries.pop(ref_id, None)
        if entry:
            with contextlib.suppress(OSError):
                os.remove(entry.path)

    def cleanup_expired(self) -> int:
        now = time.time()
        with self.lock:
            pinned = set().union(*self.pins.values()) if self.pins else set()
            expired = [entry for ref_id, entry in self.entries.items() if now - entry.created > self.ttl and ref_id not in pinned]
            for entry in expired:
                self.entries.pop(entry.ref_id, None)
        for entry in expired:
            with contextlib.suppress(OSError):
                os.remove(entry.path)
        return len(expired)


# Module-level singleton
upload_store: UploadStore | None = None


def init_upload_store(staging_dir: str, ttl: int = 1800):
    global upload_store  # pylint: disable=global-statement
    upload_store = UploadStore(staging_dir, ttl)
    kept = upload_store.reindex()
    from modules.api.helpers import register_upload_store

    register_upload_store(get_upload_store)
    log.debug(f"Upload store: dir={staging_dir} ttl={ttl}s kept={kept}")


def get_upload_store() -> UploadStore:
    if upload_store is None:
        raise RuntimeError("Upload store not initialized")
    return upload_store


# Pydantic models


class UploadRef(BaseModel):
    ref: str
    name: str
    size: int
    url: str


class UploadResponse(BaseModel):
    uploads: list[UploadRef]


class DeleteResponse(BaseModel):
    status: str


# Router

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB
MAX_FILES_PER_REQUEST = 20

upload_router = APIRouter(prefix="/sdapi/v2", tags=["Upload"])
upload_media_router = APIRouter(prefix="/sdapi/v2", tags=["Upload"], dependencies=[Depends(media_auth)])


IMAGE_SIGNATURES = {
    b"\x89PNG": "image/png",
    b"\xff\xd8\xff": "image/jpeg",
    b"RIFF": "image/webp",
    b"GIF8": "image/gif",
}


def detect_image_type(data: bytes) -> str | None:
    for sig, mime in IMAGE_SIGNATURES.items():
        if data[: len(sig)] == sig:
            if sig == b"RIFF" and data[8:12] != b"WEBP":
                continue
            return mime
    return None


@upload_router.post("/upload", response_model=UploadResponse)
async def upload_files(files: list[UploadFile]):
    store = get_upload_store()
    store.cleanup_expired()
    if len(files) > MAX_FILES_PER_REQUEST:
        raise HTTPException(status_code=400, detail=f"Maximum {MAX_FILES_PER_REQUEST} files per request")
    refs: list[UploadRef] = []
    for f in files:
        chunks = []
        total_read = 0
        while True:
            chunk = await f.read(64 * 1024)
            if not chunk:
                break
            total_read += len(chunk)
            if total_read > MAX_FILE_SIZE:
                raise HTTPException(status_code=400, detail=f"File '{f.filename}' exceeds {MAX_FILE_SIZE // (1024 * 1024)}MB limit")
            chunks.append(chunk)
        data = b"".join(chunks)
        content_type = detect_image_type(data) or f.content_type or "application/octet-stream"
        entry = store.store(data, f.filename or "upload.png", content_type)
        refs.append(
            UploadRef(
                ref=f"upload:{entry.ref_id}",
                name=entry.name,
                size=entry.size,
                url=f"/sdapi/v2/uploads/{entry.ref_id}",
            )
        )
    return UploadResponse(uploads=refs)


@upload_media_router.get("/uploads/{ref_id}")
async def get_upload(ref_id: str):
    store = get_upload_store()
    entry = store.get(ref_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Upload not found or expired")
    return FileResponse(entry.path, media_type=entry.content_type, filename=entry.name)


@upload_router.delete("/uploads/{ref_id}", response_model=DeleteResponse)
async def delete_upload(ref_id: str):
    store = get_upload_store()
    entry = store.get(ref_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Upload not found or expired")
    try:
        store.remove(ref_id)
    except UploadInUse as e:
        raise HTTPException(status_code=409, detail=f"Upload in use: {e}") from e
    return {"status": "ok"}
