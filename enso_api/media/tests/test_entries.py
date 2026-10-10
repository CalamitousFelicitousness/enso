import os

import pytest

from enso_api.media.collector import HOUR_MS, free_now
from enso_api.media.entries import MAX_PINNED, Entries, EntryIn, EntryPatch, EntryRank, Gone, Refused, evict_past_cap, evictions
from enso_api.media.tests.helpers import link_record, png, put


@pytest.fixture
def entries(store, db, clock):
    return Entries(db, store.held, store.settings, clock)


def blobs(store, *seeds):
    return [put(store, png(seed))[0].hash for seed in seeds]


def entry(entry_id: str, hashes: dict[str, str], pinned: bool = False, trashed_at: int | None = None, thumbs=(), saved_at: int = 5, used_at: int = 5) -> EntryIn:
    inputs = {"frames": [{"pictures": [{"cid": cid} for cid in hashes]}]}
    return EntryIn(
        id=entry_id,
        kind="frame",
        name=entry_id,
        saved_at=saved_at,
        used_at=used_at,
        pinned=pinned,
        trashed_at=trashed_at,
        frames=1,
        pictures=len(hashes),
        role="reference",
        control=None,
        width=8,
        height=8,
        inputs_schema=3,
        inputs=inputs,
        maps={},
        hashes=hashes,
        unavailable=[],
        thumbs=list(thumbs),
    )


def fill(entries, store, clock, count: int, prefix: str = "e", pinned: bool = False) -> list[str]:
    (digest,) = blobs(store, 1)
    ids = []
    for i in range(count):
        clock.advance(1000)
        ids.append(entries.save(entry(f"{prefix}{i:02d}", {"p": digest}, pinned=pinned), "alice", False).entry["id"])
    return ids


def test_a_save_names_its_pictures_and_thumbnails(entries, store):
    picture, thumb = blobs(store, 1, 2)
    saved = entries.save(entry("e1", {"p": picture}, thumbs=[{"cid": "p", "hash": picture, "thumb": thumb, "width": 4, "height": 4}]), "alice", False)
    assert saved.created
    assert store.row(picture).unnamed_since is None
    assert store.row(thumb).unnamed_since is None
    assert saved.entry["user"] == "alice"
    assert saved.entry["thumbs"] == [{"cid": "p", "hash": picture, "thumb": thumb, "width": 4, "height": 4, "lost": False}]
    assert saved.entry["bytes"] == store.row(picture).size + store.row(thumb).size


def test_a_saved_id_answers_as_it_is_before_any_check(entries, store):
    (picture,) = blobs(store, 1)
    entries.save(entry("e1", {"p": picture}), None, False)
    again = entries.save(entry("e1", {"p": "f" * 64}, trashed_at=7), None, False)
    assert not again.created
    assert again.entry["trashed_at"] is None


def test_a_missing_or_lost_hash_is_refused_with_the_issue_list(entries, store, clock):
    (picture,) = blobs(store, 1)
    with store.db.write() as w:
        w.conn.execute("UPDATE blobs SET lost_at = ? WHERE hash = ?", (clock(), picture))
    with pytest.raises(Refused) as refused:
        entries.save(entry("e1", {"p": picture, "q": "f" * 64}), None, False)
    assert {issue["type"] for issue in refused.value.issues} == {"upload_missing"}
    assert sorted(issue["input"] for issue in refused.value.issues) == sorted([picture, "f" * 64])
    assert entries.list(False) == []


def test_the_server_stamps_the_times_unless_migrating(entries, store, clock):
    (picture,) = blobs(store, 1)
    plain = entries.save(entry("plain", {"p": picture}, saved_at=1, used_at=2), None, False).entry
    moved = entries.save(entry("moved", {"p": picture}, saved_at=1, used_at=2, trashed_at=3), None, True).entry
    assert (plain["saved_at"], plain["used_at"]) == (clock(), clock())
    assert (moved["saved_at"], moved["used_at"], moved["trashed_at"], moved["trashed_cause"]) == (1, 2, 3, "removed")
    with pytest.raises(Refused) as refused:
        entries.save(entry("late", {"p": picture}, trashed_at=3), None, False)
    assert refused.value.issues[0]["type"] == "not_migrating"


def test_the_cap_counts_unpinned_entries_and_pushes_out_the_least_recently_used(entries, store, clock):
    store.update_settings({"library_cap": 10})
    pins = fill(entries, store, clock, 3, "pin", pinned=True)
    ids = fill(entries, store, clock, 10)
    clock.advance(1000)
    entries.patch(ids[0], EntryPatch(used=True), None)
    (picture,) = blobs(store, 1)
    clock.advance(1000)
    saved = entries.save(entry("new", {"p": picture}), "bob", False)
    assert saved.pushed_out == [{"id": ids[1], "name": ids[1]}]
    gone = entries.list(False, [ids[1]])[0]
    assert (gone["trashed_cause"], gone["trashed_by"]) == ("evicted", "bob")
    assert {item["id"] for item in entries.list(False)} >= {*pins, "new", ids[0]}


def test_a_row_never_evicts_itself(entries, store, clock):
    store.update_settings({"library_cap": 10})
    ids = fill(entries, store, clock, 10)
    trashed = ids[0]
    entries.patch(trashed, EntryPatch(trashed=True), None)
    fill(entries, store, clock, 1, "x")
    back = entries.patch(trashed, EntryPatch(trashed=False), None)
    assert back.entry["trashed_at"] is None
    assert [pushed["id"] for pushed in back.pushed_out] == [ids[1]]


def test_a_migrating_save_past_the_cap_is_refused_and_moves_nothing(entries, store, clock):
    store.update_settings({"library_cap": 10})
    fill(entries, store, clock, 10)
    (picture,) = blobs(store, 1)
    with pytest.raises(Refused) as refused:
        entries.save(entry("moved", {"p": picture}), None, True)
    assert (refused.value.code, refused.value.fields) == ("library_full", {"cap": 10, "count": 10})
    assert len(entries.list(False)) == 10
    assert entries.list(True) == []


def test_the_pins_are_bounded(entries, store, clock):
    fill(entries, store, clock, MAX_PINNED, "pin", pinned=True)
    (picture,) = blobs(store, 1)
    with pytest.raises(Refused) as refused:
        entries.save(entry("one-more", {"p": picture}, pinned=True), None, False)
    assert refused.value.code == "pins_full"
    moved = entries.save(entry("moved", {"p": picture}, pinned=True), None, True)
    assert moved.unpinned and not moved.entry["pinned"]
    with pytest.raises(Refused):
        entries.patch("moved", EntryPatch(pinned=True), None)


def test_trash_and_untrash(entries, store, clock):
    (picture,) = blobs(store, 1)
    entries.save(entry("e1", {"p": picture}, pinned=True), None, False)
    clock.advance(1000)
    trashed = entries.patch("e1", EntryPatch(trashed=True), "carol")
    assert (trashed.entry["trashed_at"], trashed.entry["trashed_by"], trashed.entry["trashed_cause"], trashed.trash_moved) == (clock(), "carol", "removed", True)
    clock.advance(1000)
    again = entries.patch("e1", EntryPatch(trashed=True), "dave")
    assert again.entry["trashed_by"] == "carol" and not again.trash_moved
    fill(entries, store, clock, MAX_PINNED, "pin", pinned=True)
    clock.advance(1000)
    back = entries.patch("e1", EntryPatch(trashed=False), None)
    assert back.entry["trashed_at"] is None and back.entry["used_at"] == clock()
    assert back.unpinned and not back.entry["pinned"]


def test_a_rename_and_a_use_of_a_trashed_entry_are_applied(entries, store, clock):
    (picture,) = blobs(store, 1)
    entries.save(entry("e1", {"p": picture}), None, False)
    entries.patch("e1", EntryPatch(trashed=True), None)
    clock.advance(1000)
    changed = entries.patch("e1", EntryPatch(name="  Kept  ", used=True), None)
    assert (changed.entry["name"], changed.entry["used_at"]) == ("Kept", clock())
    with pytest.raises(Refused):
        entries.patch("e1", EntryPatch(name="   "), None)
    with pytest.raises(Gone):
        entries.patch("nope", EntryPatch(used=True), None)


def test_the_list_orders_pinned_first_then_by_use_and_reports_lost_thumbs(entries, store, clock):
    picture, thumb = blobs(store, 1, 2)
    for name, pinned in (("old", False), ("pinned", True), ("new", False)):
        clock.advance(1000)
        entries.save(entry(name, {"p": picture}, pinned=pinned, thumbs=[{"cid": "p", "hash": picture, "thumb": thumb, "width": 4, "height": 4}]), None, False)
    with store.db.write() as w:
        w.conn.execute("UPDATE blobs SET lost_at = 1 WHERE hash = ?", (thumb,))
    listed = entries.list(False)
    assert [item["id"] for item in listed] == ["pinned", "new", "old"]
    assert all(item["thumbs"][0]["lost"] for item in listed)
    assert [item["id"] for item in entries.list(False, ["old", "nope"])] == ["old"]


def test_get_lists_the_cids_whose_bytes_are_lost(entries, store):
    picture, other = blobs(store, 1, 2)
    entries.save(entry("e1", {"p": picture, "q": other}), None, False)
    with store.db.write() as w:
        w.conn.execute("UPDATE blobs SET lost_at = 1 WHERE hash = ?", (other,))
    full = entries.get("e1")
    assert full["lost"] == ["q"]
    assert full["hashes"] == {"p": picture, "q": other}
    assert entries.get("nope") is None


def test_delete_takes_only_trashed_entries(entries, store):
    (picture,) = blobs(store, 1)
    entries.save(entry("kept", {"p": picture}), None, False)
    entries.save(entry("gone", {"p": picture}), None, False)
    entries.patch("gone", EntryPatch(trashed=True), None)
    deleted = entries.delete(["kept", "gone", "nope"])
    assert deleted.ids == ["gone"]
    assert deleted.hashes == {picture}
    assert [item["id"] for item in entries.list(False)] == ["kept"]


def test_emptying_frees_what_only_those_entries_named_and_nothing_touched_within_the_hour(entries, store, clock):
    alone, shared, recorded, claimed = blobs(store, 1, 2, 3, 4)
    clock.advance(2 * HOUR_MS)
    entries.save(entry("trash", {"a": alone, "b": shared, "c": recorded, "d": claimed}), None, False)
    entries.save(entry("kept", {"b": shared}), None, False)
    link_record(store, "job", [recorded])
    entries.patch("trash", EntryPatch(trashed=True), None)
    assert entries.reclaimable() == store.row(alone).size + store.row(claimed).size
    store.claim([claimed])
    alone_size, alone_path = store.row(alone).size, store.path(store.row(alone))
    deleted = entries.delete(["trash"])
    assert free_now(store, deleted.hashes) == alone_size
    assert store.row(alone) is None and not os.path.exists(alone_path)
    assert store.row(shared) is not None and store.row(recorded) is not None and store.row(claimed) is not None
    assert store.row(claimed).unnamed_since is not None


def test_evictions_are_stable_under_ties_and_keep_the_kept_row():
    rows = [EntryRank("b", 1, 1), EntryRank("a", 1, 1), EntryRank("c", 1, 0), EntryRank("d", 9, 9)]
    assert evictions(rows, 2, None) == ["c", "a"]
    assert evictions(rows, 2, "c") == ["a", "b"]
    assert evictions(rows, 4, None) == []


def test_the_pass_evicts_past_the_cap_and_never_a_pinned_or_trashed_row(entries, store, clock, db):
    store.update_settings({"library_cap": 10})
    pins = fill(entries, store, clock, 2, "pin", pinned=True)
    ids = fill(entries, store, clock, 10)
    entries.patch(ids[5], EntryPatch(trashed=True), None)
    gone = evict_past_cap(db, 7, clock())
    assert gone == [ids[0], ids[1]]
    assert {item["id"] for item in entries.list(False)} == {*pins, *ids[2:5], *ids[6:]}
