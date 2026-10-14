from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field

from enso_api.job_models import JobRequest
from enso_api.media.settings import BOUNDS
from enso_api.models import StrictBaseModel

Hash = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]


class ResBlobV2(BaseModel):
    hash: str
    size: int
    type: str
    """The sniffed type; application/octet-stream for anything that is not media."""
    ext: str
    name: str
    ref: str
    """upload:<hash>, the form a job request names it by."""
    url: str
    created: bool
    """False when the server already held these bytes."""


class ReqClaimV2(StrictBaseModel):
    hashes: list[str] = Field(max_length=1000)
    bytes: int = Field(default=0, ge=0)
    """The bytes the client is about to send, checked against the free space."""


class SpaceV2(BaseModel):
    ok: bool
    free: int
    needed: int


class ResClaimV2(BaseModel):
    present: list[str]
    """Held; marked as kept."""
    missing: list[str]
    lost: list[str]
    """Known, but the file is gone; sending the bytes again heals it."""
    space: SpaceV2


class ReqAdoptOutputV2(StrictBaseModel):
    output_id: str


class ReqAdoptPathV2(StrictBaseModel):
    path: str
    """A file the Gallery lists."""


class SettingBoundV2(BaseModel):
    low: int
    high: int
    default: int


class ResMediaSettingsV2(BaseModel):
    trash_days: int
    library_cap: int
    record_cap: int
    reserve_bytes: int
    max_input_pixels: int
    """The largest picture, in pixels, the server takes in an upload or a request."""
    bounds: dict[str, SettingBoundV2]


def bounded(key: str):
    bound = BOUNDS[key]
    # Omitted means unchanged; an explicit null is refused, since None is not an int
    return Field(default=None, ge=bound.low, le=bound.high)


class ReqMediaSettingsV2(StrictBaseModel):
    trash_days: int = bounded("trash_days")
    library_cap: int = bounded("library_cap")
    record_cap: int = bounded("record_cap")
    reserve_bytes: int = bounded("reserve_bytes")
    max_input_pixels: int = bounded("max_input_pixels")


class MediaTermV2(BaseModel):
    count: int = 0
    bytes: int = 0


class MediaTermsV2(BaseModel):
    library: MediaTermV2 = Field(default_factory=MediaTermV2)
    records: MediaTermV2 = Field(default_factory=MediaTermV2)
    trash: MediaTermV2 = Field(default_factory=MediaTermV2)
    unnamed: MediaTermV2 = Field(default_factory=MediaTermV2)


class LastVerifyV2(BaseModel):
    at: int = 0
    checked: int = 0
    lost: int = 0
    corrupt: int = 0
    changed: int = 0
    cancelled: bool = False


class VerifyStateV2(BaseModel):
    running: bool = False
    checked: int = 0
    total: int = 0


class ResSnapshotV2(BaseModel):
    path: str
    bytes: int


class MediaEventDataV2(BaseModel):
    verify: VerifyStateV2
    """The verify pass's state, carried by every media event."""


class ChangedIdsV2(BaseModel):
    ids: list[str] | None
    """What changed since the socket last heard of this topic; null when it is further behind than the server
    remembers, which means read the whole list again."""


class MediaSettingsValuesV2(BaseModel):
    trash_days: int
    library_cap: int
    record_cap: int
    reserve_bytes: int


class ResMediaReportV2(BaseModel):
    enabled: bool
    reason: str | None = None
    root: str | None = None
    configured_root: str = ""
    previous_root: str | None = None
    free: int = 0
    total: int = 0
    count: int = 0
    bytes: int = 0
    by_term: MediaTermsV2 = Field(default_factory=MediaTermsV2)
    """Held blobs under the first term that names them: an entry in the library, a record or a running job, an entry in the trash, none."""
    lost: int = 0
    transient: int = 0
    snapshots: MediaTermV2 = Field(default_factory=MediaTermV2)
    corrupt: MediaTermV2 = Field(default_factory=MediaTermV2)
    last_gc: int | None = None
    last_verify: LastVerifyV2 | None = None
    verify: VerifyStateV2 = Field(default_factory=VerifyStateV2)
    files_in_trash: MediaTermV2 = Field(default_factory=MediaTermV2)
    """Gallery files in the trash with the sidecars that went with them; not counted in the blobs above."""
    trash_lost: int = 0
    """Gallery files whose file is gone from the trash; each row goes after the trash days."""
    trash_strays: int = 0
    """Folders in the trash no row holds, as the last check found them; they go after the trash days."""


class ReqRecordV2(StrictBaseModel):
    client: str = Field(min_length=1, max_length=64)
    """The browser profile that keeps this record, the one that routes its result."""
    checkpoint: dict[str, Any] | None = None
    refs: dict[str, Any] = Field(default_factory=dict)
    """Where each upload ref of the request came from, as the client describes it."""
    inputs: dict[str, Any] | None = None
    map_keys: list[str] = Field(default_factory=list)
    maps: dict[str, str] = Field(default_factory=dict)
    """Map key to the cid of a map the job sent as a picture."""
    hashes: dict[str, Hash] = Field(default_factory=dict)
    """Cid to hash for every picture, mask object and map the record names."""
    unavailable: list[str] = Field(default_factory=list)
    """Cids whose bytes the client could not read; named nowhere."""
    record_schema: int = Field(default=1, ge=1)
    """The shape of `inputs` and `refs`; a reader refuses a record newer than it knows."""


class ReqSubmitV2(StrictBaseModel):
    submit_id: str = Field(pattern=r"^[0-9a-f]{32}$")
    """Minted by the client per submission; sending it again answers the job it queued."""
    job: JobRequest
    record: ReqRecordV2


class ReqRecordPutV2(ReqRecordV2):
    request: dict[str, Any]
    domain: str = Field(min_length=1, max_length=32)
    created_at: int = Field(ge=0)
    routed: bool


class ReqRecordPatchV2(StrictBaseModel):
    routed: Literal[True]


class ItemRecordV2(BaseModel):
    job_id: str
    client: str
    user: str | None = None
    domain: str
    created_at: int
    routed: bool
    has_inputs: bool
    missing_refs: int
    """Refs of the request the server does not hold or has lost: their pictures are remade from the client's copies."""
    lost: int
    """Pictures and maps of the record whose bytes are lost."""
    unavailable: int
    """Pictures the client could not read when it sent the record."""


class ResRecordsV2(BaseModel):
    records: list[ItemRecordV2]


class ResRecordV2(ItemRecordV2):
    checkpoint: dict[str, Any] | None = None
    request: dict[str, Any]
    refs: dict[str, Any]
    inputs: dict[str, Any] | None = None
    map_keys: list[str]
    maps: dict[str, str]
    hashes: dict[str, str]
    unavailable_cids: list[str]
    record_schema: int = 1
    lost_cids: list[str]
    missing_ref_ids: list[str]


class EntrySummaryV2(StrictBaseModel):
    frames: int = Field(ge=0)
    pictures: int = Field(ge=0)
    role: str | None = None
    control: str | None = None
    """A Control frame's type; null for a set and for other roles."""
    width: int = Field(ge=0)
    height: int = Field(ge=0)
    inputs_schema: int = Field(ge=0)


class EntryThumbInV2(StrictBaseModel):
    cid: str
    hash: Hash
    """The picture's hash."""
    thumb: Hash
    """The thumbnail's hash."""
    width: int = Field(ge=0)
    height: int = Field(ge=0)


class ReqEntryV2(StrictBaseModel):
    id: str = Field(min_length=1, max_length=64)
    kind: Literal["frame", "set"]
    name: str = Field(min_length=1, max_length=200)
    saved_at: int = Field(default=0, ge=0)
    used_at: int = Field(default=0, ge=0)
    pinned: bool = False
    trashed_at: int | None = None
    summary: EntrySummaryV2
    inputs: dict[str, Any]
    maps: dict[str, str] = Field(default_factory=dict)
    hashes: dict[str, Hash] = Field(default_factory=dict)
    unavailable: list[str] = Field(default_factory=list)
    thumbs: list[EntryThumbInV2] = Field(default_factory=list)
    migrating: bool = False
    """Moved from a browser: its times are kept, and the cap and the pins refuse rather than push anything out."""


class ItemThumbV2(BaseModel):
    cid: str
    hash: str
    thumb: str
    width: int
    height: int
    lost: bool


class ItemEntryV2(BaseModel):
    id: str
    kind: str
    name: str
    user: str | None = None
    saved_at: int
    used_at: int
    pinned: bool
    trashed_at: int | None = None
    trashed_by: str | None = None
    trashed_cause: str | None = None
    """removed or evicted."""
    expires_at: int | None = None
    """When a trashed entry is deleted, from the server's clock and its trash days."""
    frames: int
    pictures: int
    role: str | None = None
    control: str | None = None
    width: int
    height: int
    inputs_schema: int
    bytes: int
    thumbs: list[ItemThumbV2]


class ResEntryV2(ItemEntryV2):
    inputs: dict[str, Any]
    maps: dict[str, str]
    hashes: dict[str, str]
    unavailable: list[str]
    lost: list[str]
    """Cids whose bytes are lost."""


class PushedOutV2(BaseModel):
    id: str
    name: str


class ResEntryChangeV2(BaseModel):
    entry: ItemEntryV2
    pushed_out: list[PushedOutV2]
    """Entries the cap moved to the trash."""
    unpinned: bool
    """The entry came back unpinned, every pin being taken."""
    created: bool


class ReqEntryPatchV2(StrictBaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    pinned: bool | None = None
    used: Literal[True] | None = None
    trashed: bool | None = None


class PinsV2(BaseModel):
    count: int
    max: int


class ResLibraryV2(BaseModel):
    entries: list[ItemEntryV2]
    cap: int
    pins: PinsV2
    days: int


class ResTrashV2(BaseModel):
    entries: list[ItemEntryV2]
    reclaimable: int
    """The bytes named by trashed entries and nothing else."""
    days: int


class ReqEmptyTrashV2(StrictBaseModel):
    ids: list[str] = Field(min_length=1, max_length=1000)


class ResFreedV2(BaseModel):
    deleted: list[str]
    freed: int
    """The bytes deleted now; bytes claimed within the hour go with the grace."""


class ReqTrashFilesV2(StrictBaseModel):
    files: list[str] = Field(min_length=1, max_length=5000)


class FileErrorV2(BaseModel):
    file: str
    error: str


class MovedFileV2(BaseModel):
    file: str
    """A Gallery file that left its folder, as the request spelled it; a sidecar the Gallery lists is spelled in its folder."""
    path: str
    """Where it is in the trash."""


class ItemTrashedFileV2(BaseModel):
    id: str
    name: str
    folder: str
    """The folder it came from, resolved."""
    folder_label: str
    """That folder as the Gallery names it."""
    path: str
    """The file in the trash, which the Gallery's read routes serve."""
    kind: Literal["image", "video"]
    size: int
    bytes: int
    """With the sidecars that went with it."""
    mtime: int
    trashed_at: int
    trashed_by: str | None = None
    expires_at: int
    output_ids: list[str]
    """The outputs rows that name it or its sidecars, which keep serving it from the trash."""
    lost: bool
    """Its file is gone from the trash; the row goes after the trash days."""


class ResTrashedV2(BaseModel):
    trashed: list[ItemTrashedFileV2]
    moved: list[MovedFileV2]
    errors: list[FileErrorV2]


class ResGalleryTrashV2(BaseModel):
    items: list[ItemTrashedFileV2]
    total: int
    bytes: int
    days: int
    as_of: int
    """The server's time of this read; Empty sends it back, so what was trashed after is left."""


class ReqRestoreFilesV2(StrictBaseModel):
    ids: list[str] = Field(min_length=1, max_length=1000)
    folder: str | None = None
    """A Gallery folder to restore into, in place of each file's own."""


class RestoredFileV2(BaseModel):
    id: str
    path: str
    name: str
    renamed: bool
    """Another file had its name or a sidecar's, so it came back as `<stem> (restored)`."""
    left: list[str]
    """Sidecars that could not come back."""


class IdErrorV2(BaseModel):
    id: str
    name: str
    error: str


class ResRestoredV2(BaseModel):
    restored: list[RestoredFileV2]
    errors: list[IdErrorV2]


class ReqDeleteTrashedV2(StrictBaseModel):
    ids: list[str] = Field(min_length=1, max_length=1000)


class ReqEmptyGalleryTrashV2(StrictBaseModel):
    as_of: int = Field(ge=0)


class TrashedOutputV2(BaseModel):
    item: str
    expires_at: int


class ResTrashedOutputsV2(BaseModel):
    trashed: dict[str, TrashedOutputV2]
    """Outputs whose files are in the trash, by output id."""
    gone: dict[str, int]
    """Outputs deleted from the trash within the hour, by output id, with when."""
