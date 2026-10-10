"""The media store's own thread: a collection pass every five minutes, the verify pass on request, a walk of the files after it."""

import logging
import threading
from collections.abc import Callable
from typing import NamedTuple

log = logging.getLogger("sd")

PASS_SECONDS = 300


class VerifyState(NamedTuple):
    running: bool
    checked: int
    total: int


Progress = Callable[[int, int], None]


class MediaWorker(threading.Thread):
    """Runs injected steps; a step that raises is logged with its traceback and the loop goes on."""

    def __init__(
        self,
        reconcile: Callable[[bool], object],
        collect: Callable[[], object],
        verify: Callable[[threading.Event, Progress], object],
        on_progress: Callable[[VerifyState], None] | None = None,
        interval: float = PASS_SECONDS,
    ):
        super().__init__(daemon=True, name="enso-media")
        self.reconcile = reconcile
        self.collect = collect
        self.verify = verify
        self.on_progress = on_progress
        self.interval = interval
        self.wake_event = threading.Event()
        self.cancel = threading.Event()
        self.lock = threading.Lock()
        self.requested = False
        self.state = VerifyState(False, 0, 0)
        self.stopping = threading.Event()

    def run(self) -> None:
        # Boot walked the files already, before the queue started
        while not self.stopping.is_set():
            if self.take_request():
                self.step("verify", self.run_verify)
                self.step("reconciliation", lambda: self.reconcile(True))
            self.step("collection", self.collect)
            self.wake_event.wait(self.interval)
            self.wake_event.clear()

    def stop(self) -> None:
        """End the loop after the step in progress; a running verify is cancelled."""
        self.stopping.set()
        self.cancel.set()
        self.wake()

    @staticmethod
    def step(name: str, fn: Callable[[], object]) -> None:
        try:
            fn()
        except Exception as e:
            log.error(f"Media store: {name} failed: {type(e).__name__}: {e}", exc_info=True)

    def take_request(self) -> bool:
        with self.lock:
            if not self.requested:
                return False
            self.requested = False
            self.cancel.clear()
            return True

    def run_verify(self) -> None:
        try:
            self.verify(self.cancel, self.progress)
        finally:
            with self.lock:
                self.state = VerifyState(False, self.state.checked, self.state.total)
            self.publish()

    def progress(self, checked: int, total: int) -> None:
        with self.lock:
            self.state = VerifyState(True, checked, total)
        self.publish()

    def publish(self) -> None:
        if self.on_progress is not None:
            self.on_progress(self.verify_state())

    def request_verify(self) -> bool:
        """False while a verify is requested or running."""
        with self.lock:
            if self.requested or self.state.running:
                return False
            self.requested = True
            self.state = VerifyState(True, 0, 0)
        self.publish()
        self.wake()
        return True

    def cancel_verify(self) -> None:
        with self.lock:
            if self.requested:
                self.requested = False
                self.state = VerifyState(False, 0, 0)
        self.cancel.set()
        self.publish()

    def verify_state(self) -> VerifyState:
        with self.lock:
            return self.state

    def wake(self) -> None:
        self.wake_event.set()
