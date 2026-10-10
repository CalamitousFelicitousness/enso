"""Stored documents read without their schema: the upload refs a request names, the cids a document names and
the blobs a row keeps alive.

The browser names a picture by a cid under a key named "cid"; a map key carries cids inside a string and names nothing.
"""

import re
from dataclasses import dataclass

REF_PREFIX = "upload:"
HASH_RE = re.compile(r"[0-9a-f]{64}")
MISSING = "This upload is no longer held; send the picture again"

Loc = tuple


def refs_in(value) -> set[str]:
    """Upload ref ids named anywhere in a request."""
    if isinstance(value, str):
        return {value[len(REF_PREFIX) :]} if value.startswith(REF_PREFIX) else set()
    if isinstance(value, dict):
        value = list(value.values())
    if isinstance(value, list) and value:
        return set().union(*(refs_in(item) for item in value))
    return set()


def ref_locations(value, path: Loc = ()) -> list[tuple[Loc, str]]:
    """Every upload ref named in a request, with the path to it."""
    if isinstance(value, str):
        return [(path, value[len(REF_PREFIX) :])] if value.startswith(REF_PREFIX) else []
    if isinstance(value, dict):
        return [loc for key, item in value.items() for loc in ref_locations(item, (*path, key))]
    if isinstance(value, list):
        return [loc for i, item in enumerate(value) for loc in ref_locations(item, (*path, i))]
    return []


def cid_locations(value, path: Loc = ()) -> list[tuple[Loc, str]]:
    """Every string under a key named "cid", at any depth, with the path to it."""
    if isinstance(value, dict):
        found = []
        for key, item in value.items():
            if key == "cid" and isinstance(item, str):
                found.append(((*path, key), item))
            else:
                found.extend(cid_locations(item, (*path, key)))
        return found
    if isinstance(value, list):
        return [loc for i, item in enumerate(value) for loc in cid_locations(item, (*path, i))]
    return []


def cids_in(value) -> set[str]:
    return {cid for _, cid in cid_locations(value)}


def held_refs(request) -> set[str]:
    """The ids among a request's refs that are hashes."""
    return {ref for ref in refs_in(request) if HASH_RE.fullmatch(ref)}


def issue(loc: Loc, msg: str, kind: str, value) -> dict:
    """One validation issue in FastAPI's 422 shape; `type` is the stable code."""
    return {"loc": list(loc), "msg": msg, "type": kind, "input": value}


def ref_issues(params, missing: set[str], loc: Loc, message: str = MISSING) -> list[dict]:
    """An upload_missing issue at each place a request names one of the missing ref ids."""
    return [issue((*loc, *path), message, "upload_missing", f"{REF_PREFIX}{ref_id}") for path, ref_id in ref_locations(params) if ref_id in missing]


def missing_issues(missing: set[str], locations: dict[str, list[Loc]]) -> list[dict]:
    """An upload_missing issue at each place a document names a hash the store does not hold."""
    return [issue(loc, MISSING, "upload_missing", digest) for digest in sorted(missing) for loc in locations.get(digest, [])]


@dataclass(frozen=True)
class Checked:
    """What a document names once it passes."""

    names: frozenset[str]  # hashes that must be held
    refs: frozenset[str]  # the hash refs of a record's request
    locations: dict[str, list[Loc]]  # where each name and ref sits
    hashes: dict[str, str]  # pruned to the cids the document names
    unavailable: tuple[str, ...]  # cids declared unavailable and named without a hash
    issues: tuple[dict, ...]  # empty when the document passes


class Scan:
    def __init__(self, hashes: dict[str, str], unavailable, loc: Loc):
        self.hashes = hashes
        self.declared = set(unavailable)
        self.loc = loc
        self.locations: dict[str, list[Loc]] = {}
        self.names: set[str] = set()
        self.found: set[str] = set()
        self.unavailable: set[str] = set()
        self.issues: list[dict] = []

    def name(self, digest: str, loc: Loc) -> None:
        self.names.add(digest)
        places = self.locations.setdefault(digest, [])
        if loc not in places:
            places.append(loc)

    def cid(self, cid: str, loc: Loc, may_be_unavailable: bool) -> str | None:
        """The hash a cid names, else None with an issue unless it may be and is declared unavailable."""
        self.found.add(cid)
        digest = self.hashes.get(cid)
        if digest is not None:
            self.name(digest, (*self.loc, "hashes", cid))
        elif may_be_unavailable and cid in self.declared:
            self.unavailable.add(cid)
        else:
            self.issues.append(issue((*self.loc, *loc), "This picture has no hash; upload it, or list it as unavailable", "unhashed_cid", cid))
        return digest

    def document(self, inputs, maps: dict[str, str]) -> None:
        for path, cid in cid_locations(inputs):
            self.cid(cid, ("inputs", *path), may_be_unavailable=True)
        for key, cid in maps.items():
            self.cid(cid, ("maps", key), may_be_unavailable=False)

    def checked(self, refs: frozenset[str] = frozenset()) -> Checked:
        hashes = {cid: digest for cid, digest in self.hashes.items() if cid in self.found}
        return Checked(frozenset(self.names), refs, self.locations, hashes, tuple(sorted(self.unavailable)), tuple(self.issues))


def check_entry(inputs, maps: dict[str, str], hashes: dict[str, str], unavailable, thumbs: list[dict], loc: Loc = ("body",)) -> Checked:
    """The names of a library entry: its pictures, its maps and its thumbnails."""
    scan = Scan(hashes, unavailable, loc)
    scan.document(inputs, maps)
    for i, thumb in enumerate(thumbs):
        digest = scan.cid(thumb["cid"], ("thumbs", i, "cid"), may_be_unavailable=False)
        if digest is not None and thumb["hash"] != digest:
            scan.issues.append(issue((*loc, "thumbs", i, "hash"), "This thumbnail's picture hash is not the one in hashes", "hash_mismatch", thumb["hash"]))
        scan.name(thumb["thumb"], (*loc, "thumbs", i, "thumb"))
    return scan.checked()


def check_record(request, inputs, maps: dict[str, str], hashes: dict[str, str], unavailable, loc: Loc = ("body",), request_loc: Loc = ("body", "request")) -> Checked:
    """The names of a job record: its pictures and maps, with the hash refs of its request in `refs`."""
    scan = Scan(hashes, unavailable, loc)
    scan.document(inputs, maps)
    for path, ref_id in ref_locations(request):
        if HASH_RE.fullmatch(ref_id):
            scan.locations.setdefault(ref_id, []).append((*request_loc, *path))
    return scan.checked(frozenset(held_refs(request)))
