"""A picture's kind, size and orientation from its header without decoding it, by the walk the browser makes
(src/lib/media/dimensions.ts), and the size limit a request's pictures are held to."""

import base64
import binascii
import io
import math
import re
from collections.abc import Callable
from typing import NamedTuple

from enso_api.documents import REF_PREFIX, issue

Read = Callable[[int, int], bytes]

PAGE = 4096
MAX_PAGES = 256
MAX_SEGMENTS = 512
MAX_BOXES = 512
UNBOUNDED = 1 << 62

# No browser applies a WebP's EXIF orientation, so neither does the server
IGNORES_ORIENTATION = frozenset({"webp"})

NOT_BASE64 = re.compile(r"[^A-Za-z0-9+/]")


class Dimensions(NamedTuple):
    kind: str
    width: int
    height: int
    orientation: int
    """The EXIF value, 1 to 8."""

    @property
    def pixels(self) -> int:
        return self.width * self.height


class Unreadable(Exception):
    pass


class Bytes:
    """Cached 4 KB pages over the reader; a walk past the page budget gives up."""

    def __init__(self, read: Read):
        self.read = read
        self.pages: dict[int, bytes] = {}

    def at(self, offset: int, length: int) -> bytes:
        if offset < 0 or length < 0:
            raise Unreadable
        out = bytearray()
        while len(out) < length:
            pos = offset + len(out)
            index = pos // PAGE
            page = self.pages.get(index)
            if page is None:
                if len(self.pages) >= MAX_PAGES:
                    raise Unreadable
                page = self.read(index * PAGE, PAGE)
                self.pages[index] = page
            start = pos - index * PAGE
            if start >= len(page):
                raise Unreadable
            out += page[start : start + length - len(out)]
        return bytes(out)


def u16be(b: bytes, i: int) -> int:
    return int.from_bytes(b[i : i + 2], "big")


def u16le(b: bytes, i: int) -> int:
    return int.from_bytes(b[i : i + 2], "little")


def u32be(b: bytes, i: int) -> int:
    return int.from_bytes(b[i : i + 4], "big")


def u32le(b: bytes, i: int) -> int:
    return int.from_bytes(b[i : i + 4], "little")


def i32le(b: bytes, i: int) -> int:
    return int.from_bytes(b[i : i + 4], "little", signed=True)


HEIC_BRANDS = {b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"hevm", b"hevs"}


def kind_of(head: bytes) -> str | None:
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if head.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if head.startswith((b"GIF87a", b"GIF89a")):
        return "gif"
    if head.startswith((b"\xff\x0a", b"\x00\x00\x00\x0cJXL \x0d\x0a\x87\x0a")):
        return "jxl"
    if head.startswith(b"\x00\x00\x00\x0cjP  \x0d\x0a\x87\x0a"):
        return "jp2"
    if head.startswith((b"II*\x00", b"MM\x00*")):
        return "tiff"
    if head.startswith(b"BM") and u32le(head, 14) in (12, 40, 52, 56, 64, 108, 124):
        return "bmp"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    if head[4:8] == b"ftyp" and len(head) >= 12:
        size = min(u32be(head, 0), len(head))
        major = head[8:12]
        brands = {major} | {head[i : i + 4] for i in range(16, size - 3, 4)}
        avif = bool(brands & {b"avif", b"avis"})
        if major in (b"avif", b"avis") or (major in (b"mif1", b"msf1") and avif):
            return "avif"
        if brands & HEIC_BRANDS or major in (b"mif1", b"msf1"):
            return "heic"
    return None


Found = tuple[int, int, int] | None


def tiff_orientation(data: Bytes, start: int) -> int:
    """The EXIF orientation tag (274) in a TIFF structure starting at `start`."""
    head = data.at(start, 8)
    u16, u32 = (u16le, u32le) if head[0] == 0x49 else (u16be, u32be)
    ifd = start + u32(head, 4)
    count = u16(data.at(ifd, 2), 0)
    if count > 512:
        return 1
    entries = data.at(ifd + 2, count * 12)
    for i in range(count):
        if u16(entries, i * 12) == 274:
            value = u16(entries, i * 12 + 8)
            return value if 1 <= value <= 8 else 1
    return 1


def exif_orientation(data: Bytes, start: int, length: int) -> int:
    prefix = data.at(start, min(length, 6))
    try:
        return tiff_orientation(data, start + 6 if prefix == b"Exif\0\0" else start)
    except Unreadable:
        return 1


def png(data: Bytes) -> Found:
    ihdr = data.at(8, 16)
    if ihdr[4:8] != b"IHDR":
        return None
    width, height, orientation = u32be(ihdr, 8), u32be(ihdr, 12), 1
    pos = 8 + 12 + 13
    for _ in range(64):
        header = data.at(pos, 8)
        length, chunk = u32be(header, 0), header[4:8]
        if chunk in (b"IDAT", b"IEND"):
            break
        if chunk == b"eXIf":
            orientation = exif_orientation(data, pos + 8, length)
            break
        pos += 12 + length
    return width, height, orientation


def gif(data: Bytes) -> Found:
    head = data.at(0, 13)
    width, height = u16le(head, 6), u16le(head, 8)
    pos = 13 + (3 * 2 ** ((head[10] & 7) + 1) if head[10] & 0x80 else 0)
    for _ in range(MAX_SEGMENTS):
        block = data.at(pos, 1)[0]
        if block == 0x2C:
            # Decoders grow the screen to the first frame
            d = data.at(pos + 1, 8)
            width = max(width, u16le(d, 0) + u16le(d, 4))
            height = max(height, u16le(d, 2) + u16le(d, 6))
            break
        if block != 0x21:
            break
        pos += 2
        for _ in range(65536):
            size = data.at(pos, 1)[0]
            pos += 1 + size
            if size == 0:
                break
        else:
            return None
    return width, height, 1


def bmp(data: Bytes) -> Found:
    head = data.at(14, 12)
    if u32le(head, 0) == 12:
        return u16le(head, 4), u16le(head, 6), 1
    # A top-down file stores its height negative
    return i32le(head, 4), abs(i32le(head, 8)), 1


def webp(data: Bytes) -> Found:
    head = data.at(12, 18)
    chunk = head[0:4]
    if chunk == b"VP8 ":
        if head[11:14] != b"\x9d\x01\x2a":
            return None
        return u16le(head, 14) & 0x3FFF, u16le(head, 16) & 0x3FFF, 1
    if chunk == b"VP8L":
        b = head[9:]
        width = 1 + (((b[1] & 0x3F) << 8) | b[0])
        height = 1 + (((b[3] & 0x0F) << 10) | (b[2] << 2) | ((b[1] & 0xC0) >> 6))
        return width, height, 1
    if chunk != b"VP8X":
        return None
    flags = head[8]
    width = 1 + int.from_bytes(head[12:15], "little")
    height = 1 + int.from_bytes(data.at(27, 3), "little")
    orientation = 1
    if flags & 0x08:
        pos = 12
        for _ in range(64):
            header = data.at(pos, 8)
            size = u32le(header, 4)
            if header[0:4] == b"EXIF":
                orientation = exif_orientation(data, pos + 8, size)
                break
            pos += 8 + size + (size & 1)
    return width, height, orientation


def tiff(data: Bytes) -> Found:
    head = data.at(0, 8)
    u16, u32 = (u16le, u32le) if head[0] == 0x49 else (u16be, u32be)
    ifd = u32(head, 4)
    count = u16(data.at(ifd, 2), 0)
    if count > 512:
        return None
    entries = data.at(ifd + 2, count * 12)
    width = height = 0
    orientation = 1
    for i in range(count):
        at = i * 12
        tag = u16(entries, at)
        value = u16(entries, at + 8) if u16(entries, at + 2) == 3 else u32(entries, at + 8)
        if tag == 256:
            width = value
        elif tag == 257:
            height = value
        elif tag == 274 and 1 <= value <= 8:
            orientation = value
    return width, height, orientation


SOF = set(range(0xC0, 0xD0)) - {0xC4, 0xC8, 0xCC}


def jpeg(data: Bytes) -> Found:
    pos = 2
    orientation = 1
    for _ in range(MAX_SEGMENTS):
        head = data.at(pos, 4)
        if head[0] != 0xFF:
            return None
        marker = head[1]
        if marker == 0xFF:
            pos += 1
            continue
        if marker == 0x01 or 0xD0 <= marker <= 0xD8:
            pos += 2
            continue
        if marker in (0xD9, 0xDA):
            return None
        length = u16be(head, 2)
        if marker in SOF:
            sof = data.at(pos + 4, 5)
            return u16be(sof, 3), u16be(sof, 1), orientation
        if marker == 0xE1 and orientation == 1 and data.at(pos + 4, 6) == b"Exif\0\0":
            orientation = exif_orientation(data, pos + 4, length - 2)
        pos += 2 + length
    return None


class Box(NamedTuple):
    type: bytes
    start: int
    content: int
    end: int


def boxes(data: Bytes, start: int, stop: int) -> list[Box]:
    out: list[Box] = []
    pos = start
    while pos + 8 <= stop and len(out) < MAX_BOXES:
        try:
            head = data.at(pos, 8)
        except Unreadable:
            break  # the end of the file
        size, content = u32be(head, 0), pos + 8
        if size == 1:
            size = int.from_bytes(data.at(pos + 8, 8), "big")
            content = pos + 16
        elif size == 0:
            size = stop - pos
        if size < 8:
            break
        out.append(Box(head[4:8], pos, content, pos + size))
        pos += size
    return out


def first(found: list[Box], kind: bytes) -> Box | None:
    return next((box for box in found if box.type == kind), None)


def heif_orientation(turns: int, mirror: int | None) -> int:
    """The EXIF orientation a HEIF rotation (quarter turns anticlockwise) and mirror give."""
    if mirror is None:
        return (1, 8, 3, 6)[turns]
    return (2, 7, 4, 5)[(turns + (2 if mirror == 1 else 0)) % 4]


def primary_item(data: Bytes, meta: Box) -> Found:
    """The primary item's size through ipma to its own ispe, irot, imir and clap."""
    children = boxes(data, meta.content + 4, meta.end)
    pitm, iprp = first(children, b"pitm"), first(children, b"iprp")
    if not pitm or not iprp:
        return None
    p = data.at(pitm.content, 8)
    primary = u16be(p, 4) if p[0] == 0 else u32be(p, 4)
    parts = boxes(data, iprp.content, iprp.end)
    ipco, ipma = first(parts, b"ipco"), first(parts, b"ipma")
    if not ipco or not ipma:
        return None
    props = boxes(data, ipco.content, ipco.end)
    table = data.at(ipma.content, ipma.end - ipma.content)
    version, wide = table[0], table[3] & 1 == 1
    at = 8
    associated: list[int] = []
    for _ in range(u32be(table, 4)):
        if at >= len(table):
            break
        item = u16be(table, at) if version < 1 else u32be(table, at)
        at += 2 if version < 1 else 4
        count = table[at]
        at += 1
        listed = []
        for _ in range(count):
            listed.append(u16be(table, at) & 0x7FFF if wide else table[at] & 0x7F)
            at += 2 if wide else 1
        if item == primary:
            associated = listed
    width = height = turns = 0
    mirror = None
    for index in associated:
        if not 0 < index <= len(props):
            continue
        prop = props[index - 1]
        if prop.type == b"ispe":
            d = data.at(prop.content, 12)
            width, height = u32be(d, 4), u32be(d, 8)
        elif prop.type == b"irot":
            turns = data.at(prop.content, 1)[0] & 3
        elif prop.type == b"imir":
            mirror = data.at(prop.content, 1)[0] & 1
        elif prop.type == b"clap":
            d = data.at(prop.content, 16)
            w = u32be(d, 0) / max(1, u32be(d, 4))
            h = u32be(d, 8) / max(1, u32be(d, 12))
            if w > 0 and h > 0:
                width, height = int(w), int(h)
    return (width, height, heif_orientation(turns, mirror)) if width > 0 and height > 0 else None


def isobmff(data: Bytes) -> Found:
    top = boxes(data, 0, UNBOUNDED)
    meta = first(top, b"meta")
    found = primary_item(data, meta) if meta else None
    moov = first(top, b"moov")
    if moov:
        # A sequence takes the larger of its still and its track
        for trak in (box for box in boxes(data, moov.content, moov.end) if box.type == b"trak"):
            tkhd = first(boxes(data, trak.content, trak.end), b"tkhd")
            if not tkhd:
                continue
            at = 88 if data.at(tkhd.content, 1)[0] == 1 else 76
            d = data.at(tkhd.content, at + 8)
            width, height = u32be(d, at) >> 16, u32be(d, at + 4) >> 16
            if not found or width * height > found[0] * found[1]:
                found = (width, height, found[2] if found else 1)
    return found


def jp2(data: Bytes) -> Found:
    top = boxes(data, 0, UNBOUNDED)
    jp2h, jp2c = first(top, b"jp2h"), first(top, b"jp2c")
    if not jp2h or not jp2c:
        return None
    ihdr = first(boxes(data, jp2h.content, jp2h.end), b"ihdr")
    if not ihdr:
        return None
    h = data.at(ihdr.content, 8)
    height, width = u32be(h, 0), u32be(h, 4)
    siz = data.at(jp2c.content, 24)
    if u16be(siz, 0) != 0xFF4F or u16be(siz, 2) != 0xFF51:
        return None
    # A header that disagrees with the codestream is not trusted
    if (u32be(siz, 8) - u32be(siz, 16), u32be(siz, 12) - u32be(siz, 20)) != (width, height):
        return None
    return width, height, 1


JXL_RATIOS = (None, (1, 1), (12, 10), (4, 3), (3, 2), (16, 9), (5, 4), (2, 1))


def jxl_codestream(b: bytes) -> Found:
    """JPEG XL's SizeHeader and the orientation in the image metadata after it."""
    bit = 16

    def u(n: int) -> int:
        nonlocal bit
        value = 0
        for i in range(n):
            if bit >> 3 >= len(b):
                raise Unreadable
            value |= ((b[bit >> 3] >> (bit & 7)) & 1) << i
            bit += 1
        return value

    def u32dist() -> int:
        return 1 + u((9, 13, 18, 30)[u(2)])

    def side(small: bool) -> int:
        return (u(5) + 1) * 8 if small else u32dist()

    small = u(1) == 1
    height = side(small)
    ratio = u(3)
    width = height * JXL_RATIOS[ratio][0] // JXL_RATIOS[ratio][1] if ratio else side(small)
    orientation = 1
    if not u(1) and u(1):
        orientation = 1 + u(3)
    return width, height, orientation


def jxl(data: Bytes) -> Found:
    if data.at(0, 2) == b"\xff\x0a":
        return jxl_codestream(data.at(0, 32))
    for box in boxes(data, 0, UNBOUNDED):
        if box.type == b"jxlc":
            return jxl_codestream(data.at(box.content, 32))
        if box.type == b"jxlp":
            return jxl_codestream(data.at(box.content + 4, 32))
    return None


READERS: dict[str, Callable[[Bytes], Found]] = {
    "png": png,
    "jpeg": jpeg,
    "gif": gif,
    "bmp": bmp,
    "webp": webp,
    "tiff": tiff,
    "avif": isobmff,
    "heic": isobmff,
    "jp2": jp2,
    "jxl": jxl,
}


def image_size(read: Read) -> Dimensions | None:
    """The picture's kind, size and orientation from its header; None for a kind the walk does not know or a size it
    cannot find."""
    data = Bytes(read)
    try:
        head = data.at(0, 64)
    except Unreadable:
        head = read(0, 64)
    kind = kind_of(head)
    if kind is None:
        return None
    try:
        found = READERS[kind](data)
    except (Unreadable, IndexError, KeyError):
        return None
    if not found or found[0] <= 0 or found[1] <= 0:
        return None
    return Dimensions(kind, *found)


# Pillow's format names, as the header walk names the kinds
PILLOW_KINDS = {"PNG": "png", "JPEG": "jpeg", "MPO": "jpeg", "WEBP": "webp", "GIF": "gif", "BMP": "bmp", "TIFF": "tiff", "AVIF": "avif", "HEIF": "heic", "JPEG2000": "jp2", "JXL": "jxl"}


def opened_size(source) -> tuple[str, int, int] | None:
    """The format and size Pillow reads from a file's header when it opens it, without decoding; None for a file it
    cannot open, which sdnext cannot decode either."""
    from PIL import Image

    try:
        with Image.open(source) as image:
            return PILLOW_KINDS.get(image.format or "", (image.format or "").lower()), image.width, image.height
    except (Image.UnidentifiedImageError, Image.DecompressionBombError, OSError, ValueError, SyntaxError, EOFError):
        return None


def decoded_size(walked: Dimensions | None, opened: tuple[str, int, int] | None) -> Dimensions | None:
    """The larger of the walk's size and Pillow's, the size sdnext decodes: a file the walk cannot read, or whose
    headers the two read differently, is held to what the decoder will make of it."""
    if opened is None:
        return walked
    kind, width, height = opened
    if walked is not None and walked.pixels >= width * height:
        return walked
    return Dimensions(walked.kind if walked else kind, width, height, walked.orientation if walked else 1)


def held(walked: Dimensions | None, opened: Callable[[], tuple[str, int, int] | None], limit: int | None) -> Dimensions | None:
    """The size a picture is held to. A file the walk already puts over `limit` is not opened: some of Pillow's
    readers allocate the declared canvas at open."""
    if walked is not None and limit is not None and walked.pixels > limit:
        return walked
    return decoded_size(walked, opened())


def size_of_path(path: str, limit: int | None = None) -> Dimensions | None:
    with open(path, "rb") as f:

        def read(offset: int, length: int) -> bytes:
            f.seek(offset)
            return f.read(length)

        walked = image_size(read)
    return held(walked, lambda: opened_size(path), limit)


def size_of_file(f, limit: int | None = None) -> Dimensions | None:
    """The size of a picture in an open file, which is left at its start."""

    def read(offset: int, length: int) -> bytes:
        f.seek(offset)
        return f.read(length)

    def opened():
        f.seek(0)
        return opened_size(f)

    try:
        return held(image_size(read), opened, limit)
    finally:
        f.seek(0)


def size_of_bytes(data: bytes, limit: int | None = None) -> Dimensions | None:
    walked = image_size(lambda offset, length: data[offset : offset + length])
    return held(walked, lambda: opened_size(io.BytesIO(data)), limit)


def inline_body(text: str) -> str:
    """The base64 sdnext's decoder reads from a request string (modules/api/helpers.py)."""
    if text.startswith("data:image/"):
        parts = text.split(";", 1)
        if len(parts) == 2:
            rest = parts[1].split(",", 1)
            return rest[1] if len(rest) == 2 else rest[0]
    return text


def decoded(body: str) -> bytes | None:
    try:
        return base64.b64decode(body)
    except (binascii.Error, ValueError):
        return None


def size_of_inline(text: str, limit: int | None = None) -> Dimensions | None:
    """The size of a picture sent as base64, read from the bytes sdnext's decoder makes of the whole string, whatever
    its length or the characters around the base64; None for bytes that are no picture."""
    data = decoded(inline_body(text))
    return size_of_bytes(data, limit) if data else None


def looks_inline(text: str) -> bool:
    """A request string that names itself a picture: a data URI, or base64 whose head decodes to a signature the walk
    knows. The check at submit sizes only these; every string reaching sdnext's decoder is sized at run time."""
    if text.startswith("data:image/"):
        return True
    clean = NOT_BASE64.sub("", text[:64])
    head = decoded(clean[: len(clean) // 4 * 4])
    return bool(head) and kind_of(head) is not None


def half_up(value: float) -> int:
    """JavaScript's Math.round, which the browser's words use; Python's round() takes a half to even."""
    return math.floor(value + 0.5)


def megapixels(pixels: int) -> str:
    """One decimal below 100 MP, whole above, as the browser writes it: "14.7 MP", "432 MP"."""
    tenths = half_up(pixels / 100_000)
    return f"{tenths / 10:.1f} MP" if tenths < 1000 else f"{half_up(pixels / 1_000_000)} MP"


def limit_text(pixels: int) -> str:
    return megapixels(pixels).replace(".0 MP", " MP")


def too_large_text(width: int, height: int, limit: int) -> str:
    return f"The picture is {width}\u00d7{height} ({megapixels(width * height)}); the server takes pictures up to {limit_text(limit)}"


class InputTooLarge(Exception):
    """A picture over the server's input limit, refused before it is decoded."""

    logged = True

    def __init__(self, width: int, height: int, limit: int):
        self.width, self.height, self.limit = width, height, limit
        super().__init__(too_large_text(width, height, limit))


def string_locations(value, path: tuple = ()) -> list[tuple[tuple, str]]:
    """Every string in a request, with the path to it."""
    if isinstance(value, str):
        return [(path, value)]
    if isinstance(value, dict):
        return [loc for key, item in value.items() for loc in string_locations(item, (*path, key))]
    if isinstance(value, list):
        return [loc for i, item in enumerate(value) for loc in string_locations(item, (*path, i))]
    return []


def input_issues(request, size_of_ref: Callable[[str], tuple[int, int] | None], limit: int, loc: tuple = ()) -> list[dict]:
    """An input_too_large issue at each place a request names a picture above `limit` pixels: an upload ref by the size
    `size_of_ref` gives for its id, a string that names itself a picture by the bytes it decodes to."""
    found = []
    for path, value in string_locations(request):
        if value.startswith(REF_PREFIX):
            size, shown = size_of_ref(value[len(REF_PREFIX) :]), value
        elif looks_inline(value):
            dims = size_of_inline(value, limit)
            size, shown = (dims.width, dims.height) if dims else None, "inline picture"
        else:
            continue
        if size is None or size[0] * size[1] <= limit:
            continue
        width, height = size
        entry = issue((*loc, *path), too_large_text(width, height, limit), "input_too_large", shown)
        entry["ctx"] = {"width": width, "height": height, "pixels": width * height, "limit": limit}
        found.append(entry)
    return found
