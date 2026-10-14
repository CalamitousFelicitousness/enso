import base64
import io

import pytest
from PIL import Image

from enso_api.inputs import image_size, input_issues, limit_text, looks_inline, megapixels, size_of_bytes, size_of_inline, size_of_path

JXL = "/wqwAEgMABKIAgDMAV3lEgAAFSqjjBu8nOv58kOHxbSN6wxttW1hSaLIODZJJ3BIEosQdLLb71VlJUNEK4j5OSMGI66oiU+8f+K9iQrzbQeXCgJwus/WPcuWu63VUAILAFBJIhHRziuPLYxYuksRyyewAjAAsXwCKwBDTnjABQA="


def encoded(fmt: str, size=(37, 23), orientation: int | None = None, **options) -> bytes:
    out = io.BytesIO()
    image = Image.new("RGB", size, (40, 80, 160))
    if orientation is not None:
        exif = Image.Exif()
        exif[0x0112] = orientation
        options["exif"] = exif
    image.save(out, fmt, **options)
    return out.getvalue()


class Counting:
    def __init__(self, data: bytes):
        self.data = data
        self.reads = 0

    def __call__(self, offset: int, length: int) -> bytes:
        self.reads += 1
        return self.data[offset : offset + length]


def be32(v: int) -> bytes:
    return v.to_bytes(4, "big")


def be16(v: int) -> bytes:
    return v.to_bytes(2, "big")


def box(kind: bytes, *content: bytes) -> bytes:
    body = b"".join(content)
    return be32(8 + len(body)) + kind + body


FULL = b"\0\0\0\0"


def ispe(w: int, h: int) -> bytes:
    return box(b"ispe", FULL, be32(w), be32(h))


def ftyp(major: bytes) -> bytes:
    return box(b"ftyp", major, be32(0), b"mif1")


def meta(primary: int, props: list[bytes], associations: list[tuple[int, list[int]]]) -> bytes:
    ipma = box(b"ipma", FULL, be32(len(associations)), *(be16(item) + bytes([len(ps), *ps]) for item, ps in associations))
    return box(b"meta", FULL, box(b"pitm", FULL, be16(primary)), box(b"iprp", box(b"ipco", *props), ipma))


@pytest.mark.parametrize(
    ("fmt", "kind", "options"),
    [
        ("PNG", "png", {}),
        ("JPEG", "jpeg", {}),
        ("JPEG", "jpeg", {"progressive": True}),
        ("WEBP", "webp", {"lossless": True}),
        ("WEBP", "webp", {"quality": 80}),
        ("GIF", "gif", {}),
        ("BMP", "bmp", {}),
        ("TIFF", "tiff", {}),
        ("AVIF", "avif", {}),
        ("JPEG2000", "jp2", {}),
    ],
)
def test_real_encoders_files_give_their_size(fmt, kind, options):
    assert size_of_bytes(encoded(fmt, **options)) == (kind, 37, 23, 1)


@pytest.mark.parametrize(("fmt", "kind"), [("JPEG", "jpeg"), ("PNG", "png"), ("WEBP", "webp"), ("TIFF", "tiff"), ("AVIF", "avif")])
def test_the_orientation_tag_is_read(fmt, kind):
    assert size_of_bytes(encoded(fmt, orientation=6)) == (kind, 37, 23, 6)


def test_jpeg_xl_bare_and_in_a_container():
    codestream = base64.b64decode(JXL)
    assert size_of_bytes(codestream) == ("jxl", 37, 23, 1)
    signature = be32(12) + b"JXL \x0d\x0a\x87\x0a"
    container = signature + box(b"ftyp", b"jxl ", be32(0), b"jxl ")
    assert size_of_bytes(container + box(b"jxlc", codestream)) == ("jxl", 37, 23, 1)
    assert size_of_bytes(container + box(b"jxlp", be32(0), codestream)) == ("jxl", 37, 23, 1)


def test_a_small_file_takes_one_read():
    read = Counting(encoded("PNG"))
    image_size(read)
    assert read.reads == 1


def test_large_app_segments_are_walked_by_their_lengths():
    jpeg = encoded("JPEG")
    app = b"\xff\xe2" + be16(65535) + bytes(65533)
    read = Counting(jpeg[:2] + app * 10 + jpeg[2:])
    assert image_size(read) == ("jpeg", 37, 23, 1)
    assert read.reads < 20


def test_sizes_the_walk_cannot_find():
    assert size_of_bytes(b"\xff\xd8\xff\xd9") is None
    assert size_of_bytes(encoded("PNG")[:12]) is None
    assert size_of_bytes(b"<svg/>") is None
    assert size_of_bytes(b"") is None


def test_a_gif_grows_to_its_first_frame():
    gif = b"GIF89a" + bytes([10, 0, 10, 0, 0, 0, 0]) + bytes([0x2C, 0, 0, 0, 0, 0x30, 0x75, 0x30, 0x75, 0])
    assert size_of_bytes(gif) == ("gif", 30000, 30000, 1)


def test_bmp_heights_are_positive_and_core_headers_read():
    top_down = bytearray(encoded("BMP"))
    top_down[22:26] = (-23).to_bytes(4, "little", signed=True)
    assert size_of_bytes(bytes(top_down)) == ("bmp", 37, 23, 1)
    core = b"BM" + bytes(12) + bytes([12, 0, 0, 0, 37, 0, 23, 0, 1, 0, 24, 0])
    assert size_of_bytes(core) == ("bmp", 37, 23, 1)


def test_a_png_wider_than_16_bits():
    png = bytearray(encoded("PNG"))
    png[16:20] = be32(70000)
    assert size_of_bytes(bytes(png)) == ("png", 70000, 23, 1)


def test_a_big_endian_tiff_with_long_tags():
    def entry(tag, kind, value):
        return be16(tag) + be16(kind) + be32(1) + value

    tiff = b"MM" + be16(42) + be32(8) + be16(3) + entry(256, 4, be32(50000)) + entry(257, 4, be32(40000)) + entry(274, 3, be16(6) + be16(0)) + be32(0)
    assert size_of_bytes(tiff) == ("tiff", 50000, 40000, 6)


def test_the_primary_item_past_a_large_mdat_with_its_rotation():
    file = ftyp(b"avif") + box(b"mdat", bytes(300_000)) + meta(1, [ispe(4000, 3000), box(b"irot", bytes([3]))], [(1, [1, 2])])
    read = Counting(file)
    assert image_size(read) == ("avif", 4000, 3000, 6)
    assert read.reads < 8


def test_a_grid_and_a_sequence_take_the_larger_size():
    grid = ftyp(b"heic") + meta(1, [ispe(512, 512), ispe(8000, 6000)], [(2, [1]), (1, [2])])
    assert size_of_bytes(grid) == ("heic", 8000, 6000, 1)
    tkhd = box(b"tkhd", FULL, bytes(72), be32(4096 << 16), be32(2160 << 16))
    sequence = ftyp(b"avis") + meta(1, [ispe(512, 512)], [(1, [1])]) + box(b"moov", box(b"trak", tkhd))
    assert size_of_bytes(sequence) == ("avif", 4096, 2160, 1)


def test_a_jpeg_2000_whose_header_and_codestream_disagree_is_held_to_the_larger():
    jp2 = bytearray(encoded("JPEG2000"))
    at = jp2.find(b"ihdr")
    jp2[at + 4 : at + 8] = be32(99)
    assert image_size(Counting(bytes(jp2))) is None
    assert size_of_bytes(bytes(jp2)) == ("jp2", 37, 99, 1)


def test_a_file_on_disk(tmp_path):
    path = tmp_path / "a.webp"
    path.write_bytes(encoded("WEBP", orientation=6))
    assert size_of_path(str(path)) == ("webp", 37, 23, 6)


def test_base64_and_data_uris_read_as_sdnext_decodes_them():
    png = encoded("PNG", size=(640, 480))
    text = base64.b64encode(png).decode()
    assert size_of_inline(text) == ("png", 640, 480, 1)
    assert size_of_inline(f"data:image/png;base64,{text}") == ("png", 640, 480, 1)
    wrapped = "\n".join(text[i : i + 76] for i in range(0, len(text), 76))
    assert size_of_inline(wrapped) == ("png", 640, 480, 1)
    assert size_of_inline("a prompt that is long enough to be read but is not a picture at all") is None


def test_the_server_holds_a_picture_to_the_size_pillow_decodes(monkeypatch):
    # As sdnext runs Pillow, without its decompression-bomb check
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", None)
    # A second frame header before the scan: the walk reads the first, Pillow the last
    jpeg = encoded("JPEG")
    scan = jpeg.index(b"\xff\xda")
    sof = b"\xff\xc0" + be16(17) + bytes([8]) + be16(30000) + be16(30000) + bytes([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])
    twice = jpeg[:scan] + sof + jpeg[scan:]
    assert image_size(Counting(twice)) == ("jpeg", 37, 23, 1)
    assert size_of_bytes(twice) == ("jpeg", 30000, 30000, 1)
    # Past the walk's segment budget, and a kind with no signature at all
    padded = jpeg[:2] + (b"\xff\xe2" + be16(4) + b"ab") * 600 + jpeg[2:]
    assert image_size(Counting(padded)) is None
    assert size_of_bytes(padded) == ("jpeg", 37, 23, 1)
    tga = encoded("TGA", size=(300, 200))
    assert size_of_inline(base64.b64encode(tga).decode()) == ("tga", 300, 200, 1)


def test_megapixels_as_the_browser_writes_them():
    assert megapixels(3840 * 3840) == "14.7 MP"
    assert megapixels(99_960_000) == "100 MP"
    assert megapixels(90_250_000) == "90.3 MP"
    assert limit_text(89_000_000) == "89 MP"


def test_input_issues_name_each_picture_over_the_limit():
    big = base64.b64encode(encoded("PNG", size=(4000, 3000))).decode()
    request = {
        "inputs": ["upload:" + "a" * 64, "upload:" + "b" * 64],
        "init_images": [big],
        "prompt": "a cat",
    }
    sizes = {"a" * 64: (12000, 9000), "b" * 64: (1024, 1024)}
    issues = input_issues(request, sizes.get, 10_000_000, ("body", "generate"))
    assert [i["loc"] for i in issues] == [["body", "generate", "inputs", 0], ["body", "generate", "init_images", 0]]
    assert issues[0]["type"] == "input_too_large"
    assert issues[0]["msg"] == "The picture is 12000\u00d79000 (108 MP); the server takes pictures up to 10 MP"
    assert issues[0]["ctx"] == {"width": 12000, "height": 9000, "pixels": 108_000_000, "limit": 10_000_000}
    assert issues[1]["input"] == "inline picture"
    assert input_issues(request, sizes.get, 108_000_000) == []


def test_a_picture_the_walk_puts_over_the_limit_is_never_opened(monkeypatch):
    import enso_api.inputs as inputs

    opened = []
    monkeypatch.setattr(inputs, "opened_size", lambda source: opened.append(source))
    png = bytearray(encoded("PNG"))
    png[16:24] = be32(20000) + be32(20000)
    assert size_of_bytes(bytes(png), 100_000_000) == ("png", 20000, 20000, 1)
    assert size_of_inline(base64.b64encode(bytes(png)).decode(), 100_000_000) == ("png", 20000, 20000, 1)
    assert opened == []
    size_of_bytes(bytes(png), 500_000_000)
    assert len(opened) == 1


def test_inline_pictures_are_sized_whole_whatever_surrounds_or_shortens_them(monkeypatch):
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", None)
    png = bytearray(encoded("PNG"))
    png[16:24] = be32(20000) + be32(20000)
    # Filler sdnext's decoder drops, ahead of the picture
    padded = " \n" * 200_000 + base64.b64encode(bytes(png)).decode()
    assert size_of_inline(padded, 100_000_000) == ("png", 20000, 20000, 1)
    # A whole GIF header in a few dozen characters
    gif = b"GIF89a" + bytes([1, 0, 1, 0, 0, 0, 0]) + bytes([0x2C, 0, 0, 0, 0, 0xFF, 0xFF, 0xFF, 0xFF, 0]) + bytes([2, 0, 0x3B])
    short = base64.b64encode(gif).decode()
    assert len(short) < 64
    assert size_of_inline(short) == ("gif", 65535, 65535, 1)


def test_only_strings_that_name_themselves_pictures_are_sized_at_submit():
    png = base64.b64encode(encoded("PNG")).decode()
    assert looks_inline(png)
    assert looks_inline("data:image/png;base64,AAAA")
    assert not looks_inline("masterpiece, best quality, a cat on a windowsill at dusk")
    assert not looks_inline("QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo" * 4)
