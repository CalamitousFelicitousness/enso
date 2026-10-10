"""Bytes into the store: a part file written and hashed as the body streams, with the disk space checked first."""

import asyncio
import contextlib
import hashlib
import itertools
import os
import shutil
import threading
from collections import deque
from collections.abc import AsyncIterator
from concurrent.futures import ThreadPoolExecutor
from typing import NamedTuple

from enso_api.media.sniff import HEAD_BYTES

BATCH = 4 << 20
DEPTH = 4


class Finished(NamedTuple):
    digest: str
    size: int
    head: bytes


class Stalled(Exception):
    """No bytes arrived for the timeout."""


class Disconnected(Exception):
    """The body ended with an error before its end."""


class ShortBody(Exception):
    def __init__(self, received: int, declared: int):
        super().__init__(f"the body had {received} of the {declared} bytes Content-Length declared")
        self.received = received
        self.declared = declared


class Sink:
    """One upload's part file, written from one thread."""

    def __init__(self, part_path: str):
        self.path = part_path
        self.file = open(part_path, "xb")  # noqa: SIM115  # pylint: disable=consider-using-with
        self.hash = hashlib.sha256()
        self.head = bytearray()
        self.written = 0

    def write(self, data: bytes) -> None:
        self.file.write(data)
        self.hash.update(data)
        if len(self.head) < HEAD_BYTES:
            self.head += data[: HEAD_BYTES - len(self.head)]
        self.written += len(data)

    def close(self) -> Finished:
        self.file.flush()
        os.fsync(self.file.fileno())
        self.file.close()
        return Finished(self.hash.hexdigest(), self.written, bytes(self.head))

    def abort(self) -> None:
        """Close and remove the part; never raises."""
        with contextlib.suppress(Exception):
            self.file.close()
        with contextlib.suppress(OSError):
            os.remove(self.path)


async def pump(stream: AsyncIterator[bytes], sink: Sink, declared: int, timeout: float, batch: int = BATCH, depth: int = DEPTH) -> int:
    """Copy a body into the sink through one writer thread, at most `depth` batches in flight; the bytes written.

    Raises Stalled, Disconnected or ShortBody, or the writer's OSError; the caller aborts the sink.
    """
    loop = asyncio.get_running_loop()
    writer = ThreadPoolExecutor(max_workers=1, thread_name_prefix="enso-ingest")
    pending: deque[asyncio.Future] = deque()
    buffer = bytearray()
    received = 0

    async def flush() -> None:
        pending.append(loop.run_in_executor(writer, sink.write, bytes(buffer)))
        buffer.clear()
        while len(pending) >= depth:
            await pending.popleft()

    iterator = stream.__aiter__()
    try:
        while True:
            try:
                chunk = await asyncio.wait_for(iterator.__anext__(), timeout)
            except StopAsyncIteration:
                break
            except asyncio.TimeoutError as e:
                raise Stalled from e
            except Exception as e:
                raise Disconnected(str(e) or type(e).__name__) from e
            received += len(chunk)
            buffer += chunk
            if len(buffer) >= batch:
                await flush()
        if buffer:
            await flush()
        while pending:
            await pending.popleft()
    finally:
        # A write that already started finishes before the sink can close: the file's own lock orders them
        writer.shutdown(wait=False, cancel_futures=True)
    if received != declared:
        raise ShortBody(received, declared)
    return sink.written


class Token(NamedTuple):
    id: int
    declared: int
    part: str


class Space(NamedTuple):
    ok: bool
    free: int
    needed: int


class Inflight:
    """The uploads in progress: their declared bytes count against the free space until each lands."""

    def __init__(self):
        self.lock = threading.Lock()
        self.items: dict[int, Token] = {}
        self.ids = itertools.count(1)

    def outstanding(self) -> int:
        with self.lock:
            return sum(token.declared for token in self.items.values())

    def space_for(self, declared: int, free: int, reserve_bytes: int) -> Space:
        needed = declared + reserve_bytes + self.outstanding()
        return Space(free >= needed, free, needed)

    def register(self, declared: int, part: str) -> Token:
        """A part the server writes itself, kept from the collector without a space check."""
        with self.lock:
            token = Token(next(self.ids), declared, part)
            self.items[token.id] = token
            return token

    def reserve(self, declared: int, part: str, free: int, reserve_bytes: int) -> Token | None:
        """A token while free space minus the reserve and every upload in progress covers declared, else None."""
        with self.lock:
            if free < declared + reserve_bytes + sum(token.declared for token in self.items.values()):
                return None
            token = Token(next(self.ids), declared, part)
            self.items[token.id] = token
            return token

    def release(self, token: Token) -> None:
        with self.lock:
            self.items.pop(token.id, None)

    def parts(self) -> set[str]:
        with self.lock:
            return {token.part for token in self.items.values()}


def free_space(path: str) -> int:
    return shutil.disk_usage(path).free
