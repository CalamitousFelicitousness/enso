import io

import pytest

from enso_api.media.sniff import EXTENSIONS, OCTET, TYPES, sniff
from enso_api.media.tests.helpers import png


def pil_bytes(fmt: str) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (1, 2, 3)).save(buf, format=fmt)
    return buf.getvalue()


def ftyp(major: bytes, *compatible: bytes) -> bytes:
    body = b"ftyp" + major + b"\0\0\0\0" + b"".join(compatible)
    return (len(body) + 4).to_bytes(4, "big") + body + b"\0" * 32


@pytest.mark.parametrize(
    ("head", "ext"),
    [
        (b"\x89PNG\r\n\x1a\n" + b"\0" * 20, "png"),
        (b"\xff\xd8\xff\xe0" + b"\0" * 20, "jpg"),
        (b"RIFF\0\0\0\0WEBPVP8 ", "webp"),
        (b"GIF89a" + b"\0" * 10, "gif"),
        (b"\xff\x0a" + b"\0" * 10, "jxl"),
        (b"\x00\x00\x00\x0cJXL \x0d\x0a\x87\x0a" + b"\0" * 10, "jxl"),
        (b"II*\x00" + b"\0" * 10, "tiff"),
        (b"MM\x00*" + b"\0" * 10, "tiff"),
        (b"\x00\x00\x00\x0cjP  \x0d\x0a\x87\x0a" + b"\0" * 10, "jp2"),
        (ftyp(b"heic", b"mif1", b"heic"), "heic"),
        (ftyp(b"mif1", b"mif1", b"miaf"), "heif"),
        (ftyp(b"avif", b"mif1", b"avif"), "avif"),
        (ftyp(b"mif1", b"avif", b"miaf"), "avif"),
        (ftyp(b"isom", b"isom", b"avc1"), "mp4"),
        (ftyp(b"qt  ", b"qt  "), "mov"),
        (ftyp(b"M4A ", b"M4A ", b"isom"), "m4a"),
        (b"RIFF\0\0\0\0AVI LIST", "avi"),
        (b"\x1a\x45\xdf\xa3\x9f\x42\x86\x81\x01\x42\x82\x84webm", "webm"),
        (b"\x1a\x45\xdf\xa3\x9f\x42\x86\x81\x01\x42\x82\x88matroska", "mkv"),
        (b"RIFF\0\0\0\0WAVEfmt ", "wav"),
        (b"fLaC\0\0\0\x22", "flac"),
        (b"ID3\x04\0\0\0\0\0\0", "mp3"),
        (b"\xff\xfb\x90\x64" + b"\0" * 10, "mp3"),
        (b"\xff\xf1\x50\x80" + b"\0" * 10, "aac"),
        (b"OggS\0\x02" + b"\0" * 10, "ogg"),
        (b'TITLE "grade"\nLUT_3D_SIZE 33\n0.0 0.0 0.0\n', "cube"),
        (b"LUT_1D_SIZE 1024\n", "cube"),
        (b"just some notes\n", "txt"),
        (b"", "bin"),
        (b"RIFF\0\0\0\0ABCD", "bin"),
        (b"\x00\x01\x02\x03binary", "bin"),
        (b"BMW is not a bitmap", "txt"),
    ],
)
def test_signatures(head, ext):
    assert sniff(head).ext == ext


@pytest.mark.parametrize(("fmt", "ext"), [("PNG", "png"), ("JPEG", "jpg"), ("WEBP", "webp"), ("GIF", "gif"), ("TIFF", "tiff"), ("BMP", "bmp")])
def test_files_pillow_writes(fmt, ext):
    assert sniff(pil_bytes(fmt)).ext == ext


def test_text_cut_inside_a_character_is_still_text():
    head = ("é" * 2048).encode("utf-8")[:4095]
    assert sniff(head).ext == "txt"


def test_only_media_is_inline():
    assert sniff(png(1)).inline
    assert sniff(b"LUT_3D_SIZE 2\n").type == OCTET
    assert not sniff(b"LUT_3D_SIZE 2\n").inline
    assert not sniff(b"<svg onload=alert(1)>").inline
    assert not sniff(b"\0\0\0").inline


def test_every_extension_has_a_type():
    assert set(TYPES) == EXTENSIONS
    assert all(sniff_ext in EXTENSIONS for sniff_ext in ("png", "mp4", "wav", "cube", "txt", "bin"))
