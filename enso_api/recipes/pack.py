"""The recipe file: a ZIP whose first member names its type, recipe.json with the entry, and every blob the entry
names under its hash, stored as it is.

A file is packed from the store's own files and unpacked through the store's sink, so every byte is hashed where it
lands; nothing is placed until every member has passed, and the import never deletes a placed blob.
"""

import contextlib
import json
import os
import re
import unicodedata
import uuid
import zipfile
import zlib
from collections.abc import Callable
from dataclasses import dataclass, field

from pydantic import ValidationError

from enso_api.documents import cid_locations, cids_in, held_refs
from enso_api.inputs import InputTooLarge
from enso_api.media.ingest import BATCH, Finished, Sink
from enso_api.media.sniff import EXTENSIONS, sniff
from enso_api.media.store import MediaStore, fsync_dir, limited
from enso_api.recipes.models import FORMAT, MEMBERS_MAX, MIME, VERSION, ManifestV2

CENTRAL_MAX = 16 << 20
MANIFEST_MAX = 64 << 20
MIMETYPE = "mimetype"
MANIFEST = "recipe.json"
MEMBER_RE = re.compile(r"blobs/([0-9a-f]{64})\.([a-z0-9]{1,8})")
EPOCH = (1980, 1, 1, 0, 0, 0)
# What a damaged or hostile archive raises while it is read; a disk error is not among them
ZIP_ERRORS = (zipfile.BadZipFile, zipfile.LargeZipFile, EOFError, RuntimeError, NotImplementedError, zlib.error, UnicodeDecodeError, ValueError)


class Refusal(Exception):
    """A file or an export the rules refuse, with a status, a code, a message and fields."""

    def __init__(self, status: int, code: str, message: str, **fields):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.fields = fields


def damaged(message: str, **fields) -> Refusal:
    return Refusal(422, "damaged", message, **fields)


def file_name(name: str) -> str:
    """An entry's name as a file name: no control or format characters, no separators, .enso at the end."""
    kept = "".join("-" if ch in '/\\:*?"<>|' else ch for ch in name if unicodedata.category(ch) not in ("Cc", "Cf"))
    return f"{kept.strip(' .')[:200] or 'recipe'}.enso"


def document_hashes(inputs, thumbs: list[dict], hashes: dict[str, str]) -> dict[str, str]:
    """The hashes of the cids the frames and the thumbnails name; a map's cid is left out with the map."""
    named = cids_in(inputs) | {thumb["cid"] for thumb in thumbs}
    return {cid: digest for cid, digest in hashes.items() if cid in named}


def named_blobs(entry: dict) -> set[str]:
    """Every hash an entry names: its pictures, its thumbnails, and a recipe's request refs and preview."""
    names = set(entry.get("hashes", {}).values())
    for thumb in entry.get("thumbs", []):
        names.update((thumb["hash"], thumb["thumb"]))
    recipe = entry.get("recipe")
    if recipe is not None:
        names.update(held_refs(recipe["request"]))
        if recipe.get("preview"):
            names.add(recipe["preview"]["thumb"])
    return names


def manifest_of(entry: dict, manifest_id: str, exported_at: int, enso: str, sizes: dict[str, int]) -> dict:
    """recipe.json for an entry; a map is never carried, since its key names this server's processors."""
    return {
        "format": FORMAT,
        "version": VERSION,
        "id": manifest_id,
        "exported_at": exported_at,
        "exported_by": {"enso": enso[:100]},
        "kind": entry["kind"],
        "name": entry["name"],
        "summary": entry["summary"],
        "inputs": entry["inputs"],
        "hashes": entry["hashes"],
        "unavailable": entry["unavailable"],
        "thumbs": [{key: thumb[key] for key in ("cid", "hash", "thumb", "width", "height")} for thumb in entry["thumbs"]],
        "recipe": entry.get("recipe"),
        "blobs": {digest: {"size": size} for digest, size in sorted(sizes.items())},
    }


def pack(store: MediaStore, manifest: dict, out_path: str, cancelled: Callable[[], bool]) -> int:
    """Write the file; the bytes written. Cancelled between members, the part is removed and Refusal raised."""
    try:
        with zipfile.ZipFile(out_path, "w", allowZip64=True) as zf:
            info = zipfile.ZipInfo(MIMETYPE, EPOCH)
            zf.writestr(info, MIME, compress_type=zipfile.ZIP_STORED)
            info = zipfile.ZipInfo(MANIFEST, EPOCH)
            zf.writestr(info, json.dumps(manifest, ensure_ascii=False, separators=(",", ":")), compress_type=zipfile.ZIP_DEFLATED)
            for digest in sorted(manifest["blobs"]):
                if cancelled():
                    raise Refusal(499, "cancelled", "The export was cancelled")
                row = store.get(digest)
                if row is None:
                    raise Refusal(422, "upload_missing", "A picture this entry names is no longer held", hashes=[digest])
                info = zipfile.ZipInfo(f"blobs/{digest}.{row.ext}", EPOCH)
                info.compress_type = zipfile.ZIP_STORED
                info.file_size = row.size
                with open(store.path(row), "rb") as src, zf.open(info, "w", force_zip64=row.size >= 1 << 31) as dst:
                    while data := src.read(BATCH):
                        dst.write(data)
        with open(out_path, "rb+") as f:
            os.fsync(f.fileno())
        return os.path.getsize(out_path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.remove(out_path)
        raise


def central_directory(path: str) -> tuple[int, int]:
    """The entry count and size of a ZIP's central directory, read from its end before anything else."""
    size = os.path.getsize(path)
    with open(path, "rb") as f:
        tail_length = min(size, (1 << 16) + 22)
        f.seek(size - tail_length)
        tail = f.read(tail_length)
        at = tail.rfind(b"PK\x05\x06")
        if at < 0 or len(tail) - at < 22:
            raise Refusal(422, "not_recipe", "The file is not an Enso recipe")
        entries = int.from_bytes(tail[at + 10 : at + 12], "little")
        central = int.from_bytes(tail[at + 12 : at + 16], "little")
        if entries == 0xFFFF or central == 0xFFFFFFFF:
            locator = at - 20
            if locator < 0 or tail[locator : locator + 4] != b"PK\x06\x07":
                raise damaged("The file's directory is damaged")
            f.seek(int.from_bytes(tail[locator + 8 : locator + 16], "little"))
            record = f.read(56)
            if record[:4] != b"PK\x06\x06":
                raise damaged("The file's directory is damaged")
            entries = int.from_bytes(record[32:40], "little")
            central = int.from_bytes(record[40:48], "little")
    return entries, central


def read_manifest(zf: zipfile.ZipFile) -> ManifestV2:
    """recipe.json, its format and version checked before its fields, so a newer file says so."""
    members = zf.infolist()
    first = members[0] if members else None
    if first is None or first.orig_filename != MIMETYPE or first.compress_type != zipfile.ZIP_STORED or first.file_size > 100:
        raise Refusal(422, "not_recipe", "The file is not an Enso recipe")
    if zf.read(first).decode("ascii", "replace") != MIME:
        raise Refusal(422, "not_recipe", "The file is not an Enso recipe")
    found = [info for info in members if info.orig_filename == MANIFEST]
    if len(found) != 1:
        raise Refusal(422, "not_recipe", "The file is not an Enso recipe")
    info = found[0]
    if info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED) or info.file_size > MANIFEST_MAX:
        raise damaged("The file's description is larger than a recipe holds")
    with zf.open(info) as f:
        raw = f.read(MANIFEST_MAX + 1)
    try:
        value = json.loads(raw.decode("utf-8"))
    except ValueError as e:
        raise damaged("The file's description cannot be read") from e
    if not isinstance(value, dict) or value.get("format") != FORMAT:
        raise Refusal(422, "not_recipe", "The file is not an Enso recipe")
    version = value.get("version")
    if isinstance(version, int) and version > VERSION:
        raise Refusal(422, "newer_recipe", f"Made by a newer version of Enso (recipe file {version}; this one reads {VERSION})", version=version, reads=VERSION)
    try:
        return ManifestV2.model_validate(value)
    except ValidationError as e:
        issues = [{**error, "loc": ["manifest", *error["loc"]]} for error in e.errors(include_url=False, include_context=False, include_input=False)]
        raise Refusal(422, "bad_manifest", "The file's description is not one this version of Enso reads", issues=issues) from e


def remint(manifest: dict) -> dict:
    """The manifest with a fresh id for every picture name, the same one wherever it appears, so a file cannot
    name another picture this server or a browser already knows under the same name."""
    fresh: dict[str, str] = {}

    def renamed(cid: str) -> str:
        return fresh.setdefault(cid, str(uuid.uuid4()))

    def walk(value):
        if isinstance(value, dict):
            return {key: renamed(item) if key == "cid" and isinstance(item, str) else walk(item) for key, item in value.items()}
        if isinstance(value, list):
            return [walk(item) for item in value]
        return value

    for _, cid in cid_locations(manifest.get("inputs")):
        renamed(cid)
    return {
        **manifest,
        "inputs": walk(manifest["inputs"]),
        "hashes": {renamed(cid): digest for cid, digest in manifest["hashes"].items()},
        "unavailable": [renamed(cid) for cid in manifest["unavailable"]],
        "thumbs": [{**thumb, "cid": renamed(thumb["cid"])} for thumb in manifest["thumbs"]],
    }


@dataclass
class Verified:
    """The members that passed, each a finished part in tmp/ not yet placed."""

    parts: list[tuple[Finished, str]] = field(default_factory=list)

    def discard(self) -> None:
        for _, part in self.parts:
            with contextlib.suppress(OSError):
                os.remove(part)
        self.parts.clear()


def blob_members(zf: zipfile.ZipFile, manifest: ManifestV2, names: set[str]) -> dict[str, zipfile.ZipInfo]:
    """Every blob member by hash, each one stored, sized as the manifest says, named once and named by the entry."""
    found: dict[str, zipfile.ZipInfo] = {}
    seen: set[str] = set()
    for info in zf.infolist():
        name = info.orig_filename
        if name in seen:
            raise Refusal(422, "stray_member", "The file holds a member twice", member=name[:200])
        seen.add(name)
        if name in (MIMETYPE, MANIFEST):
            continue
        matched = MEMBER_RE.fullmatch(name)
        if matched is None or matched.group(2) not in EXTENSIONS or matched.group(1) not in manifest.blobs:
            raise Refusal(422, "stray_member", "The file holds something a recipe does not", member=name[:200])
        if info.flag_bits & 0x1:
            raise damaged("The file holds an encrypted member", member=name)
        if info.compress_type != zipfile.ZIP_STORED or info.file_size != info.compress_size or info.file_size == 0:
            raise damaged("A picture in the file is not stored as it is", member=name)
        if info.file_size != manifest.blobs[matched.group(1)].size:
            raise damaged("A picture in the file is not the size its description gives", member=name)
        found[matched.group(1)] = info
    missing = sorted((names | set(manifest.blobs)) - set(found))
    if missing:
        raise Refusal(422, "member_missing", "A picture the file names is not in it", hashes=missing[:20])
    unnamed = sorted(set(found) - names)
    if unnamed:
        raise Refusal(422, "stray_member", "The file holds a picture its entry does not name", hashes=unnamed[:20])
    return found


def verify(store: MediaStore, zf: zipfile.ZipFile, members: dict[str, zipfile.ZipInfo], max_pixels: int, member_name: Callable[[str], str]) -> Verified:
    """Stream every member into its own part and check it: the digest its name gives, a picture or a LUT, within the
    pixel limit. Nothing is placed here; a refusal removes the parts."""
    verified = Verified()
    try:
        for digest, info in sorted(members.items()):
            part = store.layout.new_part()
            sink = Sink(part)
            try:
                with zf.open(info) as src:
                    while data := src.read(BATCH):
                        sink.write(data)
                finished = sink.close()
            except BaseException:
                sink.abort()
                raise
            verified.parts.append((finished, part))
            if finished.digest != digest:
                raise Refusal(422, "hash_mismatch", "A picture in the file is not the one its name gives", member=member_name(digest))
            sniffed = sniff(finished.head)
            if not (sniffed.type.startswith("image/") or sniffed.ext == "cube"):
                raise Refusal(422, "not_media", "The file holds something that is not a picture or a LUT", member=member_name(digest))
            if sniffed.type.startswith("image/"):
                try:
                    limited(part, max_pixels)
                except InputTooLarge as e:
                    raise Refusal(422, "too_large", f"{member_name(digest)} is larger than this server takes", member=member_name(digest), width=e.width, height=e.height, limit=e.limit) from e
        return verified
    except ZIP_ERRORS as e:
        verified.discard()
        raise damaged("The file is damaged") from e
    except BaseException:
        verified.discard()
        raise


def place_all(store: MediaStore, verified: Verified) -> tuple[int, int]:
    """Take every verified part into the store; the blobs new to it and those it held."""
    added = held = 0
    try:
        for finished, part in verified.parts:
            _, created = store.place(finished, part, False)
            added += int(created)
            held += int(not created)
    finally:
        verified.discard()
    return added, held


def picture_names(manifest: ManifestV2) -> dict[str, str]:
    """A hash's picture as the user knows it, "Input 2, portrait.png", for the words of a refusal."""
    names: dict[str, str] = {}
    by_cid = manifest.hashes
    frames = (manifest.inputs or {}).get("frames", [])
    for position, frame in enumerate(frames if isinstance(frames, list) else [], start=1):
        pictures = frame.get("pictures", []) if isinstance(frame, dict) else []
        for picture in pictures if isinstance(pictures, list) else []:
            if isinstance(picture, dict) and picture.get("cid") in by_cid:
                names.setdefault(by_cid[picture["cid"]], f"Input {position}, {str(picture.get('name') or 'a picture')[:80]}")
    return names


def check_directory(path: str) -> None:
    entries, central = central_directory(path)
    if central > CENTRAL_MAX or entries > MEMBERS_MAX + 2:
        raise damaged("The file's directory is larger than a recipe holds")


def fsync_exports(folder: str) -> None:
    with contextlib.suppress(OSError):
        fsync_dir(folder)
