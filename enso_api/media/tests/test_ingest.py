import asyncio
import hashlib
import os

import pytest

from enso_api.media import ingest
from enso_api.media.ingest import Disconnected, Inflight, ShortBody, Sink, Stalled, pump

MIB = 1 << 20


async def body(data: bytes, chunk: int = MIB, stall_after: int | None = None, fail_after: int | None = None):
    for offset in range(0, len(data), chunk):
        if stall_after is not None and offset >= stall_after:
            await asyncio.sleep(10)
        if fail_after is not None and offset >= fail_after:
            raise ConnectionResetError("client went away")
        yield data[offset : offset + chunk]


def run_pump(sink, stream, declared, timeout=5.0, **kwargs):
    async def go():
        try:
            return await pump(stream, sink, declared, timeout, **kwargs)
        except BaseException:
            sink.abort()
            raise

    return asyncio.run(go())


def check_body(root, size):
    data = os.urandom(size)
    part = os.path.join(root, "a.part")
    sink = Sink(part)
    assert run_pump(sink, body(data), len(data)) == len(data)
    finished = sink.close()
    with open(part, "rb") as f:
        on_disk = hashlib.sha256(f.read()).hexdigest()
    assert finished.digest == on_disk == hashlib.sha256(data).hexdigest()
    assert finished.size == len(data)
    assert finished.head == data[:4096]


def test_body_is_written_and_hashed(root):
    check_body(root, 20 * MIB + 123)


@pytest.mark.slow
def test_large_body_is_written_and_hashed(root):
    check_body(root, 200 * MIB)


def test_small_batches_keep_order(root):
    data = os.urandom(3 * MIB + 7)
    part = os.path.join(root, "a.part")
    sink = Sink(part)
    run_pump(sink, body(data, chunk=65536), len(data), batch=100_000, depth=2)
    sink.close()
    with open(part, "rb") as f:
        assert f.read() == data


def test_stall_leaves_no_file(root):
    part = os.path.join(root, "a.part")
    with pytest.raises(Stalled):
        run_pump(Sink(part), body(os.urandom(3 * MIB), stall_after=MIB), 3 * MIB, timeout=0.2)
    assert not os.path.exists(part)


def test_disconnect_leaves_no_file(root):
    part = os.path.join(root, "a.part")
    with pytest.raises(Disconnected):
        run_pump(Sink(part), body(os.urandom(3 * MIB), fail_after=MIB), 3 * MIB)
    assert not os.path.exists(part)


def test_short_body_leaves_no_file(root):
    part = os.path.join(root, "a.part")
    with pytest.raises(ShortBody) as short:
        run_pump(Sink(part), body(os.urandom(MIB)), 2 * MIB)
    assert (short.value.received, short.value.declared) == (MIB, 2 * MIB)
    assert not os.path.exists(part)


def test_writer_error_reaches_the_caller(root, monkeypatch):
    part = os.path.join(root, "a.part")
    sink = Sink(part)

    def full(_data):
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(sink, "write", full)
    with pytest.raises(OSError) as refused:
        run_pump(sink, body(os.urandom(MIB)), MIB, batch=1000)
    assert refused.value.errno == 28
    assert not os.path.exists(part)


def test_close_syncs_the_file(root, monkeypatch):
    synced = []
    real = os.fsync
    monkeypatch.setattr(ingest.os, "fsync", lambda fd: synced.append(fd) or real(fd))
    sink = Sink(os.path.join(root, "a.part"))
    sink.write(b"x")
    sink.close()
    assert len(synced) == 1


def test_abort_removes_the_part(root):
    part = os.path.join(root, "a.part")
    sink = Sink(part)
    sink.write(b"partial")
    sink.abort()
    sink.abort()
    assert not os.path.exists(part)


def test_inflight_counts_uploads_in_progress():
    inflight = Inflight()
    first = inflight.reserve(100, "a.part", free=1000, reserve_bytes=500)
    assert first is not None
    assert inflight.reserve(401, "b.part", free=1000, reserve_bytes=500) is None
    second = inflight.reserve(400, "b.part", free=1000, reserve_bytes=500)
    assert second is not None
    assert inflight.parts() == {"a.part", "b.part"}
    assert inflight.space_for(1, free=1000, reserve_bytes=500) == (False, 1000, 1001)
    inflight.release(first)
    inflight.release(first)
    assert inflight.outstanding() == 400
    assert inflight.space_for(100, free=1000, reserve_bytes=500).ok
    own = inflight.register(10**12, "c.part")
    assert "c.part" in inflight.parts()
    inflight.release(own)
