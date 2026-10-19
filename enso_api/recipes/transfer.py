"""Exports and imports between the store and a recipe file, without the web layer."""

import os
import uuid
import zipfile
from collections.abc import Callable
from dataclasses import dataclass, field

from enso_api.media.entries import Entries, Gone
from enso_api.media.ingest import Token, free_space
from enso_api.media.models import EntryBodyV2
from enso_api.media.store import MediaStore
from enso_api.recipes import pack
from enso_api.recipes.entry import build_entry


def no_room(store: MediaStore, declared: int) -> pack.Refusal:
    space = store.inflight.space_for(declared, free_space(store.layout.root), store.settings().reserve_bytes)
    return pack.Refusal(507, "insufficient_storage", "Not enough free space on the server", free=space.free, needed=space.needed)


def reserve(store: MediaStore, declared: int, part: str) -> Token:
    token = store.inflight.reserve(declared, part, free_space(store.layout.root), store.settings().reserve_bytes)
    if token is None:
        raise no_room(store, declared)
    return token


def stored_entry(entries: Entries, entry_id: str) -> tuple[dict, str]:
    """An entry as a manifest carries it, and the id its file takes: the file it came from, else its own."""
    found = entries.get(entry_id)
    if found is None:
        raise Gone(entry_id)
    summary = {key: found[key] for key in ("frames", "pictures", "role", "control", "width", "height", "inputs_schema")}
    thumbs = [{key: thumb[key] for key in ("cid", "hash", "thumb", "width", "height")} for thumb in found["thumbs"]]
    entry = {
        "kind": found["kind"],
        "name": found["name"],
        "summary": summary,
        "inputs": found["inputs"],
        "hashes": pack.document_hashes(found["inputs"], thumbs, found["hashes"]),
        "unavailable": found["unavailable"],
        "thumbs": thumbs,
        "recipe": found["recipe"],
    }
    return entry, entries.origin_of(entry_id)


def body_entry(body: EntryBodyV2, recipe: dict | None) -> tuple[dict | None, list[dict]]:
    """The current state as a manifest carries it, checked as a save would be, else None with the issues."""
    built, issues = build_entry(body, uuid.uuid4().hex, recipe)
    if built is None:
        return None, issues
    thumbs = [thumb.model_dump() for thumb in body.thumbs]
    entry = {
        "kind": body.kind,
        "name": body.name,
        "summary": body.summary.model_dump(),
        "inputs": body.inputs,
        "hashes": pack.document_hashes(body.inputs, thumbs, body.hashes),
        "unavailable": body.unavailable,
        "thumbs": thumbs,
        "recipe": built.recipe,
    }
    return entry, []


@dataclass(frozen=True)
class Packed:
    id: str
    name: str
    bytes: int
    blobs: int


def pack_entry(store: MediaStore, entry: dict, manifest_id: str, enso: str, cancelled: Callable[[], bool]) -> Packed:
    """Pack an entry into exports/, every blob it names claimed first so the collector keeps it meanwhile."""
    names = pack.named_blobs(entry)
    claim = store.claim(sorted(names))
    if claim.missing or claim.lost:
        raise pack.Refusal(422, "upload_missing", "A picture this entry names is no longer held", hashes=sorted([*claim.missing, *claim.lost])[:20])
    sizes = {digest: store.row(digest).size for digest in names}
    export_id = uuid.uuid4().hex
    out = store.layout.export_path(export_id)
    part = f"{out}.part"
    token = reserve(store, sum(sizes.values()) + (1 << 20), part)
    try:
        manifest = pack.manifest_of(entry, manifest_id, store.now(), enso, sizes)
        size = pack.pack(store, manifest, part, cancelled)
        os.replace(part, out)
        pack.fsync_exports(store.layout.exports)
    finally:
        store.inflight.release(token)
    return Packed(export_id, pack.file_name(entry["name"]), size, len(sizes))


@dataclass
class Imported:
    entry: dict
    created: bool
    existing: dict | None = None
    pushed_out: list[dict] = field(default_factory=list)
    added: int = 0
    held: int = 0
    unavailable: int = 0


def unpack_entry(store: MediaStore, entries: Entries, part: str, user: str | None) -> Imported:
    """Read a recipe file and store its entry. Every member is verified before any is placed; an entry the library
    holds already, by the file's id, is answered without reading the members."""
    try:
        pack.check_directory(part)
        with zipfile.ZipFile(part) as zf:
            manifest = pack.read_manifest(zf)
            names_of = pack.picture_names(manifest)
            fresh = pack.remint(manifest.model_dump())
            body = EntryBodyV2(**{key: fresh[key] for key in ("kind", "name", "summary", "inputs", "hashes", "unavailable", "thumbs", "recipe")})
            entry, issues = build_entry(body, uuid.uuid4().hex, fresh["recipe"], origin=manifest.id)
            if entry is None:
                raise pack.Refusal(422, issues[0]["type"], "The file holds what a recipe here cannot keep", issues=issues)
            unavailable = len(fresh["unavailable"])
            matched = entries.matched(manifest.id)
            if matched is not None:
                return Imported(matched, False, matched, unavailable=unavailable)
            members = pack.blob_members(zf, manifest, pack.named_blobs(fresh))
            token = reserve(store, sum(info.file_size for info in members.values()), f"{part}.members")
            try:
                verified = pack.verify(store, zf, members, store.settings().max_input_pixels, lambda digest: names_of.get(digest, "A picture"))
                added, held = pack.place_all(store, verified)
            finally:
                store.inflight.release(token)
    except pack.ZIP_ERRORS as e:
        raise pack.damaged("The file is damaged") from e
    changed = entries.save(entry, user, False)
    existing = changed.entry if changed.matched_origin else None
    return Imported(changed.entry, changed.created, existing, changed.pushed_out, added, held, unavailable)
