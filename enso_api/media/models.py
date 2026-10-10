from pydantic import BaseModel, Field

from enso_api.media.settings import BOUNDS
from enso_api.models import StrictBaseModel


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


class ReqAdoptV2(StrictBaseModel):
    output_id: str


class SettingBoundV2(BaseModel):
    low: int
    high: int
    default: int


class ResMediaSettingsV2(BaseModel):
    trash_days: int
    library_cap: int
    record_cap: int
    reserve_bytes: int
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
    verify: VerifyStateV2 | None = None
    """The verify pass's progress; absent when a collection pass changed what the store holds."""


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
