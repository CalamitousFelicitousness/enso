"""The Gallery's folder listing: an entry per file, its folder and its path under it, each URL-encoded, and the mtime
and size that tell it from an earlier file at the same path.

Over names and stats only, with no sdnext import, so pytest runs it alone.
"""

import os
from urllib.parse import quote


def file_stamp(st: os.stat_result) -> tuple[int, int]:
    """A file's mtime in whole milliseconds and its size, as its listing entry and its thumbnail both report them."""
    return st.st_mtime_ns // 1_000_000, st.st_size


def entry(folder: str, path: str, st: os.stat_result) -> str:
    """`<folder>##F##<path under it>##T##<mtime ms>.<size>`; a Windows drive's colon stays unencoded."""
    msg = quote(folder) + "##F##" + quote(os.path.relpath(path, folder))
    msg = msg[:1] + ":" + msg[4:] if msg[1:4] == "%3A" else msg
    mtime, size = file_stamp(st)
    return f"{msg}##T##{mtime}.{size}"
