import os

from enso_api.listing import entry, file_stamp

MTIME_NS = 1_760_000_000_123_456_789


def written(root: str, relative: str, data: bytes = b"picture") -> str:
    path = os.path.join(root, relative)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)
    os.utime(path, ns=(MTIME_NS, MTIME_NS))
    return path


def test_the_stamp_is_the_mtime_in_whole_milliseconds_and_the_size(root):
    path = written(root, "a.png", b"12345")
    assert file_stamp(os.stat(path)) == (1_760_000_000_123, 5)


def test_an_entry_names_the_folder_the_path_under_it_and_the_stamp(root):
    path = written(root, "text/a b.png")
    assert entry(root, path, os.stat(path)) == f"{root}##F##text/a%20b.png##T##1760000000123.7"


def test_the_separators_never_appear_inside_a_name(root):
    path = written(root, "a##T##1.2##F##b.png")
    line = entry(root, path, os.stat(path))
    assert line.count("##F##") == 1
    assert line.count("##T##") == 1


def test_a_windows_drive_keeps_its_colon(root):
    st = os.stat(written(root, "a.png"))
    assert entry("C:/out", "C:/out/a.png", st) == "C:/out##F##a.png##T##1760000000123.7"
