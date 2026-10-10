"""A stored file's type from its first bytes; the name and type a client sends are never read."""

from typing import NamedTuple

HEAD_BYTES = 4096
OCTET = "application/octet-stream"


class Sniffed(NamedTuple):
    type: str
    ext: str
    inline: bool


HEIC_BRANDS = {b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"hevm", b"hevs"}
HEIF_BRANDS = {b"mif1", b"msf1"}
AVIF_BRANDS = {b"avif", b"avis"}
M4A_BRANDS = {b"M4A ", b"M4B "}
DIB_HEADER_SIZES = {12, 40, 52, 56, 64, 108, 124}

# Every extension a blob can carry, with the type it is served as
TYPES = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "webp": "image/webp",
    "gif": "image/gif",
    "jxl": "image/jxl",
    "tiff": "image/tiff",
    "jp2": "image/jp2",
    "heic": "image/heic",
    "heif": "image/heif",
    "avif": "image/avif",
    "bmp": "image/bmp",
    "mp4": "video/mp4",
    "mov": "video/quicktime",
    "avi": "video/x-msvideo",
    "webm": "video/webm",
    "mkv": "video/x-matroska",
    "wav": "audio/wav",
    "flac": "audio/flac",
    "mp3": "audio/mpeg",
    "aac": "audio/aac",
    "m4a": "audio/mp4",
    "ogg": "audio/ogg",
    "cube": OCTET,
    "txt": OCTET,
    "bin": OCTET,
}
EXTENSIONS = frozenset(TYPES)


def media(ext: str) -> Sniffed:
    kind = TYPES[ext]
    return Sniffed(kind, ext, kind != OCTET)


def ftyp(head: bytes) -> Sniffed | None:
    """ISO base media files: HEIF, AVIF, M4A, QuickTime and MP4 by their brands."""
    if head[4:8] != b"ftyp" or len(head) < 12:
        return None
    major = head[8:12]
    size = min(int.from_bytes(head[0:4], "big"), len(head))
    brands = {major} | {head[i : i + 4] for i in range(16, size - 3, 4)}
    if major in AVIF_BRANDS or (major in HEIF_BRANDS and brands & AVIF_BRANDS):
        return media("avif")
    if brands & HEIC_BRANDS:
        return media("heic")
    if major in HEIF_BRANDS:
        return media("heif")
    if major in M4A_BRANDS:
        return media("m4a")
    return media("mov" if major == b"qt  " else "mp4")


def riff(head: bytes) -> Sniffed | None:
    form = head[8:12] if head[:4] == b"RIFF" else b""
    return {b"WEBP": media("webp"), b"AVI ": media("avi"), b"WAVE": media("wav")}.get(form)


def ebml(head: bytes) -> Sniffed | None:
    if head[:4] != b"\x1a\x45\xdf\xa3":
        return None
    doctype = head.find(b"\x42\x82", 4, 64)
    return media("webm" if doctype >= 0 and b"webm" in head[doctype : doctype + 16] else "mkv")


def mpeg_audio(head: bytes) -> Sniffed | None:
    if head[:3] == b"ID3":
        return media("mp3")
    if len(head) < 3 or head[0] != 0xFF:
        return None
    if (head[1] & 0xF6) == 0xF0:  # ADTS: twelve sync bits, layer 0
        return media("aac")
    layer3 = (head[1] & 0xE0) == 0xE0 and (head[1] >> 1) & 3 == 1 and (head[1] >> 3) & 3 != 1
    return media("mp3") if layer3 and head[2] >> 4 not in (0, 15) and (head[2] >> 2) & 3 != 3 else None


def text(head: bytes) -> Sniffed | None:
    if not head or b"\0" in head:
        return None
    try:
        decoded = head.decode("utf-8")
    except UnicodeDecodeError as e:
        # the head may end inside a character
        if e.reason != "unexpected end of data" or e.start < len(head) - 3:
            return None
        decoded = head[: e.start].decode("utf-8")
    return media("cube" if "LUT_3D_SIZE" in decoded or "LUT_1D_SIZE" in decoded else "txt")


def sniff(head: bytes) -> Sniffed:
    head = head[:HEAD_BYTES]
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return media("png")
    if head.startswith(b"\xff\xd8\xff"):
        return media("jpg")
    if head.startswith((b"GIF87a", b"GIF89a")):
        return media("gif")
    if head.startswith((b"\xff\x0a", b"\x00\x00\x00\x0cJXL \x0d\x0a\x87\x0a")):
        return media("jxl")
    if head.startswith(b"\x00\x00\x00\x0cjP  \x0d\x0a\x87\x0a"):
        return media("jp2")
    if head.startswith((b"II*\x00", b"MM\x00*")):
        return media("tiff")
    if head.startswith(b"BM") and int.from_bytes(head[14:18], "little") in DIB_HEADER_SIZES:
        return media("bmp")
    if head.startswith(b"fLaC"):
        return media("flac")
    if head.startswith(b"OggS"):
        return media("ogg")
    for probe in (riff, ftyp, ebml, mpeg_audio, text):
        found = probe(head)
        if found is not None:
            return found
    return media("bin")
