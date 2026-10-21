"""The models a recipe names, as this server knows them, and the SHA-256 of each file.

Only this server writes a digest into a recipe it saves: sdnext's hash cache where it holds a full SHA-256 for the
file, else model_hashes, which the media worker fills by hashing the file itself; a digest the client sent is dropped.
An imported recipe keeps the digests its file carries, which a lookup by hash needs for a model this server lacks.
"""

import contextlib
import json
import logging
import os
import re
import sqlite3
import threading
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import NamedTuple

from enso_api import events
from enso_api.recipes.recipe import head_of
from enso_api.sqlite import Database

log = logging.getLogger("sd")

SHA256_RE = re.compile(r"[0-9a-f]{64}")
SHORTHASH_RE = re.compile(r"[0-9a-f]{10}")


def full_digest(value) -> str | None:
    return value if isinstance(value, str) and SHA256_RE.fullmatch(value) else None


class FileStat(NamedTuple):
    mtime: int  # ms
    size: int


def file_stat(path: str) -> FileStat | None:
    try:
        st = os.stat(path)
    except OSError:
        return None
    return FileStat(st.st_mtime_ns // 1_000_000, st.st_size)


class ModelHashes:
    """The digests the store computed, each valid while its file keeps the mtime and size it had."""

    def __init__(self, db: Database, now: Callable[[], int]):
        self.db = db
        self.now = now

    def get(self, path: str) -> str | None:
        stat = file_stat(path)
        if stat is None:
            return None
        with self.db.read() as conn:
            found = conn.execute("SELECT sha256 FROM model_hashes WHERE path = ? AND mtime = ? AND size = ?", (path, stat.mtime, stat.size)).fetchone()
        return found[0] if found else None

    def reader(self) -> Callable[[str], str | None]:
        """One read of the table, for a list that asks about many files."""
        with self.db.read() as conn:
            rows = {row[0]: (row[1], row[2], row[3]) for row in conn.execute("SELECT path, mtime, size, sha256 FROM model_hashes")}

        def digest(path: str) -> str | None:
            found = rows.get(path)
            return found[2] if found is not None and file_stat(path) == FileStat(found[0], found[1]) else None

        return digest

    def put(self, path: str, stat: FileStat, sha256: str) -> None:
        with self.db.write() as w:
            w.conn.execute(
                "INSERT INTO model_hashes (path, mtime, size, sha256, computed_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET mtime = excluded.mtime, size = excluded.size, sha256 = excluded.sha256, computed_at = excluded.computed_at",
                (path, stat.mtime, stat.size, sha256, self.now()),
            )


@dataclass(frozen=True)
class LocalModel:
    title: str
    name: str
    path: str
    filename: str
    type: str
    shorthash: str | None
    sha256: str | None  # what sdnext holds: a file's digest, a diffusers snapshot, or nothing


@dataclass(frozen=True)
class LocalNetwork:
    name: str
    filename: str
    short: str | None
    cached: str | None  # sdnext's cached full digest of the file, if any


class Lookup(NamedTuple):
    checkpoint: Callable[[str], LocalModel | None]
    network: Callable[[str], LocalNetwork | None]


class Wanted(NamedTuple):
    """A file the worker hashes, and what in a recipe names it."""

    filename: str
    kind: str  # checkpoint or network
    key: str  # a checkpoint's path, a network's name


def checkpoint_identity(model: dict, local: LocalModel | None, hashes: ModelHashes, wanted: list[Wanted]) -> dict:
    """A saved model as this server has it; one it does not have keeps its names and loses any digest."""
    if local is None:
        return {**model, "sha256": None}
    snapshot = None
    digest = None
    if local.type == "diffusers":
        snapshot = local.sha256 if isinstance(local.sha256, str) and not SHA256_RE.fullmatch(local.sha256) else None
        digest = full_digest(local.sha256)
    elif os.path.isfile(local.filename):
        digest = full_digest(local.sha256) or hashes.get(local.filename)
        if digest is None:
            wanted.append(Wanted(local.filename, "checkpoint", local.path))
    return {
        "title": local.title,
        "name": local.name,
        "path": local.path,
        "sha256": digest,
        "shorthash": local.shorthash if isinstance(local.shorthash, str) and SHORTHASH_RE.fullmatch(local.shorthash) else None,
        "snapshot": snapshot,
        "class_name": model.get("class_name"),
        "type": local.type or model.get("type"),
    }


def network_identity(network: dict, local: LocalNetwork | None, hashes: ModelHashes, wanted: list[Wanted]) -> dict:
    if local is None:
        return {**network, "sha256": None}
    digest = full_digest(local.cached) or hashes.get(local.filename)
    if digest is None and os.path.isfile(local.filename):
        wanted.append(Wanted(local.filename, "network", network["name"]))
    return {**network, "sha256": digest, "short": local.short[:64] if isinstance(local.short, str) else network.get("short")}


def resolve(recipe: dict, lookup: Lookup, hashes: ModelHashes) -> tuple[dict, list[Wanted]]:
    """A recipe this server saves, its models as this server has them, and the files it has not hashed yet."""
    wanted: list[Wanted] = []
    checkpoint = recipe.get("checkpoint")
    resolved = {**recipe}
    if checkpoint is not None:
        resolved["checkpoint"] = checkpoint_identity(checkpoint, lookup.checkpoint(checkpoint["title"]), hashes, wanted)
    resolved["networks"] = [network_identity(network, lookup.network(network["name"]), hashes, wanted) for network in recipe.get("networks", [])]
    return resolved, wanted


class IdentifyQueue:
    """The model files to hash, in the order asked, each once."""

    def __init__(self):
        self.lock = threading.Lock()
        self.items: dict[str, Wanted] = {}

    def add(self, wanted: Iterable[Wanted]) -> bool:
        with self.lock:
            before = len(self.items)
            for item in wanted:
                self.items.setdefault(f"{item.kind}:{item.key}:{item.filename}", item)
            return len(self.items) > before

    def take(self) -> Wanted | None:
        with self.lock:
            if not self.items:
                return None
            key = next(iter(self.items))
            return self.items.pop(key)


def fill_entries(db: Database, item: Wanted, digest: str) -> list[str]:
    """Write a digest into the recipes this server saved that name the file without one; the ids changed."""

    changed: list[str] = []
    with db.write(durable=True) as w:
        for entry_id, raw in w.conn.execute("SELECT id, recipe FROM entries WHERE recipe IS NOT NULL AND origin IS NULL").fetchall():
            recipe = json.loads(raw)
            touched = False
            checkpoint = recipe.get("checkpoint")
            if item.kind == "checkpoint" and checkpoint and checkpoint.get("path") == item.key and not checkpoint.get("sha256"):
                checkpoint["sha256"] = digest
                touched = True
            if item.kind == "network":
                for network in recipe.get("networks", []):
                    if network.get("name") == item.key and not network.get("sha256"):
                        network["sha256"] = digest
                        touched = True
            if touched:
                w.conn.execute("UPDATE entries SET recipe = ?, recipe_head = ? WHERE id = ?", (json.dumps(recipe), json.dumps(head_of(recipe)), entry_id))
                changed.append(entry_id)
    return changed


def identify_next(queue: IdentifyQueue, hashes: ModelHashes, db: Database, hasher: Callable[[str], str], stopping: Callable[[], bool]) -> int:
    """Hash the queued files one at a time until the queue is empty or the worker stops; the files hashed."""
    done = 0
    while not stopping():
        item = queue.take()
        if item is None:
            break
        stat = file_stat(item.filename)
        if stat is None:
            continue
        digest = hashes.get(item.filename)
        if digest is None:
            log.info(f"Media store: identifying {item.kind} {item.key} size={stat.size}")
            try:
                digest = hasher(item.filename)
            except OSError as e:
                log.warning(f"Media store: could not hash {item.filename}: {e}")
                continue
            # The file changed while it was read: the digest names neither version
            if file_stat(item.filename) != stat:
                continue
            hashes.put(item.filename, stat, digest)
            done += 1
        with contextlib.suppress(sqlite3.Error):
            changed = fill_entries(db, item, digest)
            if changed:
                events.changed("library", changed)
    return done


def sdnext_lookup() -> Lookup:
    """sdnext's checkpoints by title and LoRAs by name, read when asked."""

    def checkpoint(title: str) -> LocalModel | None:
        from modules import sd_checkpoint

        info = sd_checkpoint.checkpoints_list.get(title)
        if info is None:
            return None
        return LocalModel(info.title, info.model_name, info.name, info.filename, info.type, info.shorthash, info.sha256)

    def network(name: str) -> LocalNetwork | None:
        from modules import hashes
        from modules.lora import lora_load

        found = lora_load.available_networks.get(name) or lora_load.available_network_aliases.get(name)
        if found is None:
            return None
        return LocalNetwork(found.name, found.filename, found.shorthash, hashes.sha256_from_cache(found.filename, f"lora/{found.name}"))

    return Lookup(checkpoint, network)


def sdnext_hasher(filename: str) -> str:
    """The file's SHA-256, read without sdnext's job state or its cache."""
    from modules import hashes

    return hashes.calculate_sha256(filename, quiet=True)


def sdnext_hashing() -> bool:
    """Whether sdnext may hash model files; calculate_sha256 does not check --no-hashing itself."""
    from modules import shared

    return not shared.cmd_opts.no_hashing


identify_queue = IdentifyQueue()


def stored_digests() -> Callable[[str], str | None]:
    """The store's digests of model files by path; none while the store is off."""
    from enso_api.media import boot

    store = boot.state.store
    if store is None:
        return lambda _path: None
    try:
        return ModelHashes(store.db, store.now).reader()
    except sqlite3.Error:
        return lambda _path: None


def lora_digest(filename: str, name: str, stored: Callable[[str], str | None]) -> str | None:
    """A LoRA file's full digest: sdnext's own cache when it holds one, else the store's."""
    from modules import hashes

    return full_digest(hashes.sha256_from_cache(filename, f"lora/{name}")) or stored(filename)


def local_recipe(recipe: dict) -> dict:
    """A recipe this server saves, with its models as this server has them; files it has not hashed are queued."""
    from enso_api.media import boot

    store = boot.state.store
    if store is None:
        return recipe
    try:
        resolved, wanted = resolve(recipe, sdnext_lookup(), ModelHashes(store.db, store.now))
    except Exception as e:
        # A rename inside sdnext leaves the digests out, never the save
        log.warning(f"Media store: model identity not read: {type(e).__name__}: {e}")
        return {**recipe, "checkpoint": {**recipe["checkpoint"], "sha256": None} if recipe.get("checkpoint") else None, "networks": [{**n, "sha256": None} for n in recipe.get("networks", [])]}
    if wanted and sdnext_hashing() and identify_queue.add(wanted) and boot.state.worker is not None:
        boot.state.worker.wake()
    return resolved
