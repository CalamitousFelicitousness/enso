from enso_api.documents import check_entry, check_record, cids_in, held_refs, missing_issues, ref_issues, refs_in

A = "a" * 64
B = "b" * 64
T = "c" * 64
R = "d" * 64

INPUTS = {
    "frames": [
        {
            "pictures": [{"cid": "p1"}, {"cid": "p2"}],
            "mask": {"objects": [{"cid": "m1"}]},
            "ipAdapter": {"masks": [{"cid": "r1"}]},
        }
    ]
}


def test_cids_are_found_under_cid_keys_at_any_depth_and_never_inside_strings():
    document = {**INPUTS, "note": "p9", "key": "canny|1|{}|cid:p8", "nested": [{"deep": {"cid": "x1"}}], "cidish": "x2"}
    assert cids_in(document) == {"p1", "p2", "m1", "r1", "x1"}


def test_refs_are_upload_strings_at_any_depth_never_keys():
    request = {"init_images": [f"upload:{A}"], "control": [{"image": "upload:0123456789abcdef"}], f"upload:{B}": 1}
    assert refs_in(request) == {A, "0123456789abcdef"}
    assert held_refs(request) == {A}


def test_an_entry_names_its_pictures_maps_and_thumbnails_and_prunes_hashes():
    hashes = {"p1": A, "p2": A, "m1": B, "r1": B, "map1": R, "stale": T}
    thumbs = [{"cid": "p1", "hash": A, "thumb": T, "width": 8, "height": 8}]
    checked = check_entry(INPUTS, {"canny|1": "map1"}, hashes, [], thumbs)
    assert checked.issues == ()
    assert checked.names == {A, B, R, T}
    assert "stale" not in checked.hashes
    assert set(checked.hashes) == {"p1", "p2", "m1", "r1", "map1"}


def test_a_cid_without_a_hash_is_an_issue_unless_declared_unavailable():
    checked = check_entry(INPUTS, {}, {"p1": A, "m1": B, "r1": B}, ["p2"], [])
    assert checked.issues == ()
    assert checked.unavailable == ("p2",)
    refused = check_entry(INPUTS, {}, {"p1": A, "m1": B, "r1": B}, [], [])
    assert [(issue["type"], issue["input"], issue["loc"]) for issue in refused.issues] == [
        ("unhashed_cid", "p2", ["body", "inputs", "frames", 0, "pictures", 1, "cid"]),
    ]


def test_maps_and_thumbnails_need_a_hash_even_when_declared_unavailable():
    hashes = {"p1": A, "p2": A, "m1": B, "r1": B}
    thumbs = [{"cid": "p9", "hash": A, "thumb": T, "width": 8, "height": 8}]
    checked = check_entry(INPUTS, {"canny|1": "map1"}, hashes, ["map1", "p9"], thumbs)
    assert sorted(issue["input"] for issue in checked.issues) == ["map1", "p9"]


def test_a_thumbnail_whose_hash_differs_from_its_picture_is_refused():
    hashes = {"p1": A, "p2": A, "m1": B, "r1": B}
    thumbs = [{"cid": "p1", "hash": B, "thumb": T, "width": 8, "height": 8}]
    checked = check_entry(INPUTS, {}, hashes, [], thumbs)
    assert [issue["type"] for issue in checked.issues] == ["hash_mismatch"]


def test_a_record_names_its_pictures_and_reports_its_hash_refs_apart():
    request = {"init_images": [f"upload:{R}", "upload:0123456789abcdef"]}
    checked = check_record(request, INPUTS, {}, {"p1": A, "p2": A, "m1": B, "r1": B}, [])
    assert checked.names == {A, B}
    assert checked.refs == {R}
    assert checked.locations[R] == [("body", "request", "init_images", 0)]


def test_a_record_without_inputs_names_only_its_maps():
    checked = check_record({}, None, {"canny|1": "map1"}, {"map1": R}, [])
    assert checked.names == {R}
    assert checked.issues == ()


def test_missing_issues_locate_every_place_a_hash_is_named():
    checked = check_entry(INPUTS, {}, {"p1": A, "p2": A, "m1": B, "r1": B}, [], [{"cid": "p1", "hash": A, "thumb": T, "width": 8, "height": 8}])
    issues = missing_issues({A, T}, checked.locations)
    assert [(issue["loc"], issue["input"]) for issue in issues] == [
        (["body", "hashes", "p1"], A),
        (["body", "hashes", "p2"], A),
        (["body", "thumbs", 0, "thumb"], T),
    ]
    assert {issue["type"] for issue in issues} == {"upload_missing"}


def test_ref_issues_name_the_ref_where_it_sits():
    issues = ref_issues({"inputs": [{"image": f"upload:{A}"}]}, {A}, ("body", "job"))
    assert issues == [{"loc": ["body", "job", "inputs", 0, "image"], "msg": issues[0]["msg"], "type": "upload_missing", "input": f"upload:{A}"}]
