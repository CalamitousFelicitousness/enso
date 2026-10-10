import io
import os

from enso_api.media.ingest import Sink


def png(seed: int, size: int = 8) -> bytes:
    """A small PNG whose bytes differ for every seed."""
    from PIL import Image

    image = Image.new("RGB", (size, size), (seed % 256, (seed // 256) % 256, 7))
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def finish(store, data: bytes):
    """A finished part holding data, and its path."""
    part = store.layout.new_part()
    sink = Sink(part)
    sink.write(data)
    return sink.close(), part


def put(store, data: bytes, transient: bool = False):
    finished, part = finish(store, data)
    return store.place(finished, part, transient)


def link_entry(store, entry_id: str, hashes: list[str], trashed_at: int | None = None) -> None:
    with store.db.write() as w:
        w.conn.execute(
            "INSERT INTO entries (id, kind, name, saved_at, used_at, trashed_at, frames, pictures, width, height, schema, document) VALUES (?, 'frame', ?, 0, 0, ?, 1, 1, 8, 8, 1, '{}')",
            (entry_id, entry_id, trashed_at),
        )
        w.conn.executemany("INSERT INTO entry_blobs (entry_id, hash) VALUES (?, ?)", [(entry_id, h) for h in hashes])


def link_record(store, job_id: str, hashes: list[str], client: str = "c1", created_at: int = 0, routed: bool = True, domain: str = "generate") -> None:
    with store.db.write() as w:
        w.conn.execute("INSERT INTO records (job_id, client, domain, created_at, routed, document) VALUES (?, ?, ?, ?, ?, '{}')", (job_id, client, domain, created_at, int(routed)))
        w.conn.executemany("INSERT INTO record_blobs (job_id, hash) VALUES (?, ?)", [(job_id, h) for h in hashes])


def files_in(folder: str) -> list[str]:
    return sorted(os.path.relpath(os.path.join(dirpath, name), folder) for dirpath, _, names in os.walk(folder) for name in names)
