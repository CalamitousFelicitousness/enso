from typing import Literal

from pydantic import BaseModel, Field

from enso_api.media.models import EntryBodyV2, EntrySummaryV2, EntryThumbInV2, Hash, ItemEntryV2, PushedOutV2, RecipeV2
from enso_api.models import StrictBaseModel

FORMAT = "enso-recipe"
VERSION = 1
MIME = "application/vnd.enso.recipe"
EXT = ".enso"
MEMBERS_MAX = 2000


class ManifestBlobV2(StrictBaseModel):
    size: int = Field(gt=0)


class ExportedByV2(StrictBaseModel):
    enso: str = Field(max_length=100)


class ManifestV2(StrictBaseModel):
    """recipe.json: the entry a file carries, and the blobs beside it by hash."""

    format: Literal["enso-recipe"]
    version: int = Field(ge=1)
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    """The entry's id where it was first saved; an import keeps it as the new entry's origin."""
    exported_at: int = Field(ge=0)
    exported_by: ExportedByV2
    kind: Literal["frame", "set", "recipe"]
    name: str = Field(min_length=1, max_length=200)
    summary: EntrySummaryV2
    inputs: dict | None
    hashes: dict[str, Hash] = Field(default_factory=dict, max_length=MEMBERS_MAX)
    unavailable: list[str] = Field(default_factory=list, max_length=MEMBERS_MAX)
    thumbs: list[EntryThumbInV2] = Field(default_factory=list, max_length=MEMBERS_MAX)
    recipe: RecipeV2 | None = None
    blobs: dict[Hash, ManifestBlobV2] = Field(max_length=MEMBERS_MAX)
    """Every member of the file by hash; the server's own sniff decides each one's type."""


class ReqExportEntryV2(StrictBaseModel):
    entry_id: str = Field(min_length=1, max_length=64)


class ReqExportBodyV2(EntryBodyV2):
    """An entry not saved, as the current inputs and settings would be; every blob it names is held."""


class ResExportV2(BaseModel):
    id: str
    """The packed file's id; GET /sdapi/v2/export/{id} serves it for an hour."""
    name: str
    """The file's name, <entry name>.enso."""
    bytes: int
    blobs: int


class ExistingEntryV2(BaseModel):
    id: str
    name: str


class ImportedBlobsV2(BaseModel):
    added: int
    """Blobs this server did not hold before."""
    held: int


class ResImportV2(BaseModel):
    entry: ItemEntryV2
    created: bool
    """False when the library already holds the entry this file came from or went to."""
    existing: ExistingEntryV2 | None = None
    pushed_out: list[PushedOutV2]
    blobs: ImportedBlobsV2
    unavailable: int
    """Pictures the file names whose bytes its maker never had."""
