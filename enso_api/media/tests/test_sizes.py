import io
import os

import pytest
from PIL import Image

from enso_api.inputs import InputTooLarge
from enso_api.media.schema import MIGRATIONS
from enso_api.media.store import limited
from enso_api.media.tests.helpers import put
from enso_api.sqlite import Database


def picture(fmt: str, size=(40, 20), orientation: int | None = None) -> bytes:
    image = Image.new("RGB", size, (200, 30, 30))
    image.paste((30, 30, 200), (size[0] // 2, 0, size[0], size[1]))
    options = {}
    if orientation is not None:
        exif = Image.Exif()
        exif[0x0112] = orientation
        options["exif"] = exif
    out = io.BytesIO()
    image.save(out, fmt, **options)
    return out.getvalue()


def test_a_placed_picture_keeps_its_size_and_other_files_zero(store):
    row, _ = put(store, picture("PNG"))
    assert (row.width, row.height) == (40, 20)
    text, _ = put(store, b"just some text, not a picture")
    assert (text.width, text.height) == (0, 0)


def test_the_size_is_filled_for_rows_stored_without_one(store):
    row, _ = put(store, picture("JPEG"))
    with store.db.write() as w:
        w.conn.execute("UPDATE blobs SET width = NULL, height = NULL")
    assert store.fill_sizes() == 1
    assert store.fill_sizes() == 0
    assert (store.get(row.hash).width, store.get(row.hash).height) == (40, 20)


def test_a_ref_size_is_read_on_demand(store):
    row, _ = put(store, picture("WEBP", (64, 48)))
    with store.db.write() as w:
        w.conn.execute("UPDATE blobs SET width = NULL, height = NULL")
    assert store.size_of_ref(row.hash) == (64, 48)
    assert store.row(row.hash).width == 64
    assert store.size_of_ref("f" * 64) is None


def test_the_limit_refuses_above_it(store, root):
    path = os.path.join(root, "big.png")
    with open(path, "wb") as f:
        f.write(picture("PNG", (5000, 4000)))
    assert limited(path, 20_000_000) == (5000, 4000)
    with pytest.raises(InputTooLarge) as caught:
        limited(path, 19_999_999)
    assert str(caught.value) == "The picture is 5000\u00d74000 (20.0 MP); the server takes pictures up to 20 MP"


def test_a_resolved_picture_is_turned_by_its_tag_except_webp(store):
    jpeg, _ = put(store, picture("JPEG", orientation=6))
    image = store.resolve_to_image(jpeg.hash)
    assert image.size == (20, 40)
    webp, _ = put(store, picture("WEBP", orientation=6))
    assert store.resolve_to_image(webp.hash).size == (40, 20)
    upright, _ = put(store, picture("PNG"))
    assert store.resolve_to_image(upright.hash).size == (40, 20)


def test_a_resolved_picture_over_the_limit_is_refused_before_it_opens(store):
    store.update_settings({"max_input_pixels": 16_000_000})
    row, _ = put(store, picture("PNG", (5000, 4000)))
    with pytest.raises(InputTooLarge):
        store.resolve_to_image(row.hash)


def test_migration_4_adds_unread_sizes_to_a_version_3_file(root):
    path = os.path.join(root, "old.db")
    first = Database(path, MIGRATIONS[:3], label="Media store")
    with first.write() as w:
        w.conn.execute("INSERT INTO blobs (hash, ext, size, type, created_at, touched_at) VALUES ('h', 'png', 1, 'image/png', 0, 0)")
    first.close()
    second = Database(path, MIGRATIONS[:4], label="Media store")
    assert second.version == 4
    with second.read() as conn:
        assert tuple(conn.execute("SELECT width, height FROM blobs").fetchone()) == (None, None)
    second.close()
