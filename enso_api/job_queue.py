import asyncio
import contextlib
import json
import logging
import os
import shutil
import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor

from enso_api.job_store import JobStore
from enso_api.job_warnings import JobLogCapture
from enso_api.models import JobResult
from enso_api.util import job_progress, mark_dir_git_ignored, preview_image
from enso_api.ws_models import (
    WsEventCancelled,
    WsEventCompleted,
    WsEventError,
    WsEventProgress,
    WsEventStages,
    WsEventStatus,
)

OUTPUT_URL_PREFIX = "/sdapi/v2/outputs"

# Statuses a runner may still move a job out of
LIVE = ("pending", "running")

log = logging.getLogger("sd")

# (path key in a stored ref dict, url key it addresses)
REF_ADDRESSES = (("path", "url"), ("thumbnail_path", "thumbnail_url"))


def assign_output_urls(store: JobStore, result, job_id: str) -> int:
    """Rewrite each saved ref's URL in `result` to a durable output URL.

    Runs at the two persist sites on the raw executor dict before it is
    serialized, so the stored row, the completion event, and every later read
    carry the same addresses and executors never know outputs exist. The
    internal path keys stay in the stored JSON for the legacy job-scoped
    routes and base64 embedding; the response models never expose them.

    Confinement happens here, at registration, where the outdir settings are
    the same ones the file was just saved under; the serve path trusts the
    row. Staged save_images=False refs are skipped: their files are deleted
    on schedules of their own, and a durable address for a doomed file would
    lie about durability.

    Best-effort by contract: a finished generation must never be reported
    failed over bookkeeping, so failures keep the job-scoped URL, log a
    warning, and are returned for the stats counter.
    """
    failures = 0
    try:
        from enso_api.confine import confined_to_outputs

        if not isinstance(result, dict):
            return 0
        for key in ("images", "processed", "videos"):
            refs = result.get(key)
            if not isinstance(refs, list):
                continue
            for ref in refs:
                if not isinstance(ref, dict) or ref.get("temp"):
                    continue
                for path_key, url_key in REF_ADDRESSES:
                    path = ref.get(path_key)
                    if not isinstance(path, str) or not path:
                        continue
                    try:
                        if not confined_to_outputs(path):
                            raise ValueError("path outside allowed output roots")
                        ref[url_key] = f"{OUTPUT_URL_PREFIX}/{store.register_output(path, job_id=job_id)}"
                    except Exception as e:
                        failures += 1
                        log.warning(f"Job queue: output registration failed job={job_id} path={path}: {e}")
    except Exception as e:
        failures += 1
        log.warning(f"Job queue: output url assignment failed job={job_id}: {e}")
    return failures


# Maps SD.Next state.job labels → user-facing stage name
STAGE_MAP: dict[str, str] = {
    "Base": "Generate",
    "Inference": "Generate",
    "Process": "Generate",
    "Sample": "Generate",
    "Hires": "Hires",
    "Refine": "Refiner",
    "Detailer": "Detailer",
}


def migrate_db_files(old_path: str, new_path: str) -> None:
    """One-time move of the queue db out of the extension root.

    Checkpointing first folds the WAL into the main file, so only that one
    file has to move and a stale sidecar cannot replay foreign pages at the
    new location. The main file's presence at the new path marks the
    migration done; a failure leaves the old location intact for the next
    boot to retry, and queue data is ephemeral enough that starting fresh
    beats refusing to load.
    """
    if os.path.exists(new_path) or not os.path.exists(old_path):
        return
    try:
        os.makedirs(os.path.dirname(new_path), exist_ok=True)
        conn = sqlite3.connect(old_path)
        try:
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        finally:
            conn.close()
        shutil.move(old_path, new_path)
        for suffix in ("-wal", "-shm"):
            with contextlib.suppress(OSError):
                os.remove(old_path + suffix)
        log.info(f"Job queue: moved queue db to {new_path}")
    except Exception as e:
        log.error(f"Job queue: db migration failed, starting fresh at {new_path}: {e}")


def compute_stages(job_type: str, params: dict) -> list[str] | None:
    """Predict the generation stage sequence from request params."""
    if job_type != "generate":
        return None
    stages = ["Generate"]
    if params.get("enable_hr"):
        stages.append("Hires")
    if (params.get("refiner_steps") or 0) > 0:
        stages.append("Refiner")
    if params.get("detailer_enabled"):
        stages.append("Detailer")
    return stages


def job_failure(e: Exception) -> tuple[int | None, str]:
    """HTTP-semantic code and job error text for an executor exception."""
    # VideoError carries code; sdnext's API helpers raise HTTPException with status_code and detail
    code = getattr(e, "code", None)
    if not isinstance(code, int):
        code = getattr(e, "status_code", None)
    detail = getattr(e, "detail", None)
    message = detail if isinstance(detail, str) and detail else f"{type(e).__name__}: {e}"
    return (code if isinstance(code, int) else None), message


class UploadsMissing(Exception):
    """A request names uploads the media store does not hold."""

    def __init__(self, refs: list[str]):
        super().__init__(f"{len(refs)} uploads not held")
        self.refs = refs


def name_uploads(job_id: str, params) -> list[str]:
    """Name the uploads a job's request refers to, so the media store keeps them until the job is released; the ones it does not hold."""
    from enso_api.documents import refs_in
    from enso_api.media import boot

    if isinstance(params, str):
        params = json.loads(params)
    refs = refs_in(params)
    if boot.state.store is None:
        return sorted(refs)
    return boot.state.store.name_job(job_id, refs)


def release_uploads(job_id: str) -> None:
    from enso_api.media import boot

    if boot.state.store is None:
        return
    try:
        boot.state.store.release_job(job_id)
    except Exception as e:
        # The collector drops the names of a job the queue no longer holds
        log.warning(f"Job queue: uploads of id={job_id} not released: {e}")


def job_params(job: dict) -> dict:
    """A job row's request, parsed."""
    params = job.get("params", {})
    return json.loads(params) if isinstance(params, str) else params


class Sdnext:
    """The parts of sdnext the runners use, imported when first used; tests pass their own."""

    @property
    def state(self):
        from modules import shared

        return shared.state

    @property
    def queue_lock(self):
        from modules.call_queue import queue_lock

        return queue_lock

    @property
    def executors(self) -> dict:
        from enso_api.executors import EXECUTORS

        return EXECUTORS

    def display(self, e: Exception, title: str) -> None:
        from modules import errors

        errors.display(e, title)


class JobQueue:
    def __init__(self, sdnext: Sdnext | None = None):
        self.sdnext = sdnext or Sdnext()
        self.store: JobStore | None = None
        self._worker_thread: threading.Thread | None = None
        self._cloud_pool: ThreadPoolExecutor | None = None
        self._job_event = threading.Event()
        self._cancel_ids: set[str] = set()
        self.stopped_ids: set[str] = set()
        self._subscribers: dict[str, list[asyncio.Queue]] = {}
        self._sub_lock = threading.Lock()
        self._current_job_id: str | None = None
        self._initialized = False
        self.output_register_failures = 0
        self.cleanup_counter = 0
        # Jobs whose runner has not reached its finally, whatever their row says
        self.in_flight: set[str] = set()
        self.in_flight_lock = threading.Lock()

    @property
    def running_job_id(self) -> str | None:
        """Local job being executed, or None."""
        return self._current_job_id

    def note_user_stop(self) -> None:
        """Stop or Skip pressed while a local job runs."""
        if self._current_job_id is not None:
            self.stopped_ids.add(self._current_job_id)

    def stopped_by_user(self, job_id: str) -> bool:
        """The user cancelled, stopped or skipped this job while it ran."""
        return job_id in self._cancel_ids or job_id in self.stopped_ids

    def live_jobs(self) -> set[str] | None:
        """Pending and running jobs and the runners still in flight; None before the queue runs."""
        if not self._initialized or self.store is None:
            return None
        with self.in_flight_lock:
            running = set(self.in_flight)
        return self.store.live_ids() | running

    def enter(self, job_id: str) -> None:
        with self.in_flight_lock:
            self.in_flight.add(job_id)

    def leave(self, job_id: str) -> None:
        """A runner is done with its job: its uploads are released."""
        release_uploads(job_id)
        with self.in_flight_lock:
            self.in_flight.discard(job_id)

    def init(self, data_path: str, legacy_path: str | None = None) -> None:
        if self._initialized:
            return
        db_path = os.path.join(data_path, "jobs.db")
        if legacy_path:
            migrate_db_files(os.path.join(legacy_path, "jobs.db"), db_path)
        self.store = JobStore(db_path)
        mark_dir_git_ignored(data_path)
        self._recover_stale_jobs()
        self.name_live_uploads()
        self._worker_thread = threading.Thread(target=self._worker_loop, daemon=True, name="v2-job-worker")
        self._worker_thread.start()
        self._cloud_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="cloud-worker")
        self._initialized = True

    def name_live_uploads(self) -> None:
        """Name the uploads of every job left pending; a row that cannot be read is its runner's to fail."""
        for job_id in self.store.live_ids():
            try:
                job = self.store.get(job_id)
                if job is not None:
                    name_uploads(job_id, job.get("params"))
            except Exception as e:
                log.warning(f"Job queue: uploads of id={job_id} not named at boot: {type(e).__name__}: {e}")

    def _recover_stale_jobs(self):
        if self.store is None:
            return
        jobs, _ = self.store.list(status="running", limit=100)
        for job in jobs:
            self.set_status(job["id"], "failed", error="Server restarted", completed_at=JobStore.now())
            release_uploads(job["id"])

    def set_status(self, job_id: str, status: str, current: tuple[str, ...] = LIVE, **kwargs) -> bool:
        """Write a status while the job's status is one of `current`; whether it was written."""
        return self.store.update_status(job_id, status, current=current, **kwargs)

    def submit(self, job_type: str, params: dict, priority: int = 0) -> dict:
        """Queue a job; UploadsMissing when it names uploads the store does not hold.

        Its uploads are named before its row exists, so the worker never starts it with them unnamed.
        """
        job_id = JobStore.new_id()
        missing = name_uploads(job_id, params)
        if missing:
            release_uploads(job_id)
            raise UploadsMissing(missing)
        try:
            return self.enqueue(job_type, params, priority, job_id)
        except BaseException:
            release_uploads(job_id)
            raise

    def enqueue(self, job_type: str, params: dict, priority: int, job_id: str) -> dict:
        """Add the job's row and wake the worker; the row as written."""
        job = self.store.insert(job_type, params, priority, job_id)
        self.wake()
        return job

    def wake(self) -> None:
        self._job_event.set()

    def wake_if_pending(self) -> None:
        if self.store.next_pending():
            self.wake()

    def cancel(self, job_id: str) -> bool:
        job = self.store.get(job_id)
        if job is None:
            return False
        if job["status"] == "running":
            entry = self.sdnext.executors.get(job["type"])
            if entry and entry["lock"]:
                self._cancel_ids.add(job_id)
                with contextlib.suppress(Exception):
                    self.sdnext.state.interrupt()
            elif self.set_status(job_id, "cancelled", completed_at=JobStore.now()):
                self.push_progress(job_id, WsEventStatus(status="cancelled").model_dump(exclude_none=True))
            return True
        if job["status"] == "pending":
            cancelled = self.store.cancel(job_id)
            if cancelled:
                release_uploads(job_id)
                self.push_progress(job_id, WsEventCancelled().model_dump(exclude_none=True))
            return cancelled
        return self.store.delete(job_id)

    def subscribe(self, job_id: str) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()
        with self._sub_lock:
            if job_id not in self._subscribers:
                self._subscribers[job_id] = []
            self._subscribers[job_id].append(queue)
        return queue

    def unsubscribe(self, job_id: str, queue: asyncio.Queue) -> None:
        with self._sub_lock:
            subs = self._subscribers.get(job_id)
            if subs and queue in subs:
                subs.remove(queue)
                if not subs:
                    del self._subscribers[job_id]

    def push_progress(self, job_id: str, data: dict) -> None:
        with self._sub_lock:
            subs = self._subscribers.get(job_id, [])
            for q in subs:
                with contextlib.suppress(asyncio.QueueFull):
                    q.put_nowait(data)

    def _push_binary(self, job_id: str, data: bytes) -> None:
        with self._sub_lock:
            subs = self._subscribers.get(job_id, [])
            for q in subs:
                with contextlib.suppress(asyncio.QueueFull):
                    q.put_nowait(data)

    def _worker_loop(self) -> None:
        log.debug("Job queue: worker started")
        failure = None
        while True:
            failure = self.guarded_turn(failure)

    def guarded_turn(self, failure: str | None = None) -> str | None:
        """A turn that never raises; a failure is logged once while it repeats and returned for the next call.

        It decides no job's outcome: a row that failed before its runner started stays pending for the next turn.
        """
        try:
            self.turn()
        except Exception as e:
            message = f"{type(e).__name__}: {e}"
            if message != failure:
                log.exception(f"Job queue: worker turn failed: {message}")
            return message
        return None

    def turn(self) -> None:
        """Wait for work, sweep every 300 turns (five minutes when idle), run the next pending job."""
        self._job_event.wait(timeout=1.0)
        self._job_event.clear()
        if self.store is None:
            return
        self.cleanup_counter += 1
        if self.cleanup_counter >= 300:
            self.cleanup_counter = 0
            self._periodic_cleanup()
        job = self.store.next_pending()
        if job is not None:
            self._execute_job(job)

    def _periodic_cleanup(self) -> None:
        try:
            from enso_api.temp_store import cleanup_expired

            removed = cleanup_expired()
            if removed:
                log.debug(f"Job queue: cleaned {removed} expired staging dirs")
        except Exception as e:
            log.debug(f"Job queue: staging cleanup error: {e}")
        try:
            if self.store:
                purged = self.store.cleanup(max_age_hours=168)
                if purged:
                    log.debug(f"Job queue: purged {purged} old job rows")
        except Exception as e:
            log.debug(f"Job queue: job cleanup error: {e}")

    def _execute_job(self, job: dict) -> None:
        job_id = job["id"]
        job_type = job["type"]
        entry = self.sdnext.executors.get(job_type)
        if entry is None:
            log.error(f"Job queue: unknown type={job_type} id={job_id}")
            self.set_status(job_id, "failed", error=f"Unknown job type: {job_type}", completed_at=JobStore.now())
            release_uploads(job_id)
            return
        if entry["lock"]:
            self._run_local_job(job, entry["fn"], job_type, hold_lock=entry["lock"] is True)
        else:
            self._dispatch_cloud_job(job, entry["fn"], job_type)

    def finish_failed(self, job_id: str, error: str) -> None:
        """Record a live job's failure, as cancelled when the user cancelled it, and tell its subscribers."""
        cancelled = job_id in self._cancel_ids
        if not self.set_status(job_id, "cancelled" if cancelled else "failed", completed_at=JobStore.now(), error=error):
            return
        self.push_progress(job_id, WsEventError(error=error).model_dump(exclude_none=True))
        if cancelled:
            self.push_progress(job_id, WsEventStatus(status="cancelled").model_dump(exclude_none=True))

    def finish_completed(self, job_id: str, result) -> None:
        """Record a live job's result and tell its subscribers; a job cancelled meanwhile stays cancelled."""
        self.output_register_failures += assign_output_urls(self.store, result, job_id)
        result_json = json.dumps(result, default=str)
        event = WsEventCompleted(result=JobResult.from_result_dict(result)).model_dump(exclude_none=True)
        if self.set_status(job_id, "completed", completed_at=JobStore.now(), result=result_json):
            self.push_progress(job_id, event)
            log.info(f"Job queue: completed id={job_id}")
        else:
            log.info(f"Job queue: id={job_id} finished after it was cancelled")

    def clear_current(self, job_id: str) -> None:
        self._current_job_id = None
        self.stopped_ids.discard(job_id)
        self._cancel_ids.discard(job_id)

    def _run_local_job(self, job: dict, executor_fn, job_type: str, hold_lock: bool = True) -> None:
        job_id = job["id"]
        capture = None
        # A cleanup joins the stack as soon as its setup step succeeds
        with contextlib.ExitStack() as stack:
            stack.callback(self.wake_if_pending)
            try:
                self.enter(job_id)
                stack.callback(self.leave, job_id)
                if not self.set_status(job_id, "running", current=("pending",), started_at=JobStore.now()):
                    log.info(f"Job queue: skipped id={job_id}, no longer pending")
                    return
                self._current_job_id = job_id
                stack.callback(self.clear_current, job_id)
                log.info(f"Job queue: executing id={job_id} type={job_type}")
                self.push_progress(job_id, WsEventStatus(status="running").model_dump(exclude_none=True))

                params = job_params(job)
                stages = compute_stages(job_type, params)
                if stages:
                    self.push_progress(job_id, WsEventStages(stages=stages).model_dump(exclude_none=True))

                # When the client opts out of live previews, disable_preview is the single
                # chokepoint: do_set_current_image() short-circuits before the latent decode,
                # which silences the poller below, the global /ws push, and nextjob() at once.
                state = self.sdnext.state
                state.disable_preview = not params.get("live_previews", True)
                stack.callback(setattr, state, "disable_preview", False)

                poller_stop = threading.Event()
                poller = threading.Thread(target=self._progress_poller, args=(job_id, poller_stop, stages), daemon=True, name=f"v2-progress-{job_id[:8]}")
                poller.start()
                stack.callback(poller.join, timeout=2.0)
                stack.callback(poller_stop.set)

                capture = JobLogCapture()
                log.addHandler(capture)
                stack.callback(log.removeHandler, capture)

                # hold_lock=False for executors whose sdnext entry point acquires
                # queue_lock internally; serialization still holds, just one level down
                with self.sdnext.queue_lock if hold_lock else contextlib.nullcontext():
                    if job_id in self._cancel_ids:
                        if self.set_status(job_id, "cancelled", completed_at=JobStore.now()):
                            self.push_progress(job_id, WsEventStatus(status="cancelled").model_dump(exclude_none=True))
                        return
                    result = executor_fn(params, job_id)
                if capture.entries:
                    result["warnings"] = capture.entries
                self.finish_completed(job_id, result)
            except Exception as e:
                # Typed rejections (4xx code) are expected client errors: one line, no traceback
                code, error_msg = job_failure(e)
                if code is not None and 400 <= code < 500:
                    log.info(f"Job queue: rejected id={job_id} type={job_type} code={code} error={error_msg}")
                elif getattr(e, "logged", False):
                    # the executor's own reason, else the error sdnext logged for it
                    error_msg = getattr(e, "reason", None) or (capture.first_error() if capture else None) or error_msg
                    log.error(f"Job queue: failed id={job_id} type={job_type} error={error_msg}")
                else:
                    self.sdnext.display(e, f"Job queue: {job_type}")
                self.finish_failed(job_id, error_msg)

    def _dispatch_cloud_job(self, job: dict, executor_fn, job_type: str) -> None:
        """Mark the job running and hand it to the pool, whose runner owns it from then on."""
        job_id = job["id"]
        with contextlib.ExitStack() as stack:
            self.enter(job_id)
            stack.callback(self.leave, job_id)
            # Running before the pool takes it, so the next turn cannot dispatch it twice
            if not self.set_status(job_id, "running", current=("pending",), started_at=JobStore.now()):
                log.info(f"Job queue: skipped id={job_id}, no longer pending")
            else:
                job["status"] = "running"
                try:
                    self._cloud_pool.submit(self._run_cloud_job, job, executor_fn, job_type)
                    stack.pop_all()
                except Exception as e:
                    log.error(f"Job queue: cloud dispatch failed id={job_id} {type(e).__name__}: {e}")
                    self.finish_failed(job_id, f"{type(e).__name__}: {e}")
        self.wake_if_pending()

    def _run_cloud_job(self, job: dict, executor_fn, job_type: str) -> None:
        job_id = job["id"]
        with contextlib.ExitStack() as stack:
            stack.callback(self.leave, job_id)
            try:
                log.info(f"Job queue: cloud executing id={job_id} type={job_type}")
                self.push_progress(job_id, WsEventStatus(status="running").model_dump(exclude_none=True))
                result = executor_fn(job_params(job), job_id)
                self.finish_completed(job_id, result)
            except Exception as e:
                log.error(f"Job queue: cloud failed id={job_id} {type(e).__name__}: {e}")
                self.finish_failed(job_id, f"{type(e).__name__}: {e}")

    def _progress_poller(self, job_id: str, stop_event: threading.Event, stages: list[str] | None = None) -> None:
        last_step = -1
        last_job = ""
        last_textinfo = None
        last_preview = None
        # Stage tracking state
        stage_index = 0
        stage_name = stages[0] if stages else ""
        phase = None
        while not stop_event.is_set():
            try:
                if self._current_job_id != job_id:
                    break
                state = self.sdnext.state
                current_step = state.sampling_step
                current_job = state.job
                current_textinfo = state.textinfo
                changed = current_step != last_step or current_job != last_job or current_textinfo != last_textinfo
                if changed:
                    # Classify stage vs phase on job transition
                    if stages and current_job != last_job:
                        matched_stage = STAGE_MAP.get(current_job)
                        if matched_stage and matched_stage in stages:
                            stage_index = stages.index(matched_stage)
                            stage_name = matched_stage
                            phase = None
                        elif current_job:
                            phase = current_job
                    # Clear stale phase when sampling steps are actively progressing
                    if phase and current_step > 0 and current_step != last_step:
                        phase = None
                    last_step = current_step
                    last_job = current_job
                    last_textinfo = current_textinfo
                    status = state.status()
                    step = current_step
                    steps = state.sampling_steps
                    progress_val, eta_val = job_progress(state, status)
                    # Item-count jobs (metadata sweeps, hashing) never set
                    # sampling_steps, which zeroes status.progress and eta
                    if steps == 0 and getattr(status, "jobs", 0) > 0:
                        step = getattr(status, "job", 0)
                        steps = status.jobs
                        progress_val = round(min(1, step / steps), 2)
                        elapsed = getattr(status, "elapsed", None)
                        if progress_val > 0 and elapsed:
                            eta_val = round(elapsed / progress_val - elapsed, 2)
                    progress_event = WsEventProgress(
                        step=step,
                        steps=steps,
                        progress=progress_val,
                        eta=eta_val,
                        task=current_job,
                        textinfo=current_textinfo,
                        stage=stage_index if stages else None,
                        stage_name=stage_name if stages else None,
                        stage_count=len(stages) if stages else None,
                        phase=phase if stages else None,
                    )
                    if self.store is not None:
                        self.store.update_progress(job_id, progress_val, step, steps)
                    self.push_progress(job_id, progress_event.model_dump(exclude_none=True))
                    # Decode current latent into a preview image (bypasses the api guard in set_current_image)
                    state.do_set_current_image()
                    # A new preview is a new image object; sdnext resets id_live_preview on every begin()
                    if state.current_image is not None and state.current_image is not last_preview:
                        last_preview = state.current_image
                        with contextlib.suppress(Exception):
                            self._push_binary(job_id, preview_image(state.current_image))
            except Exception:
                pass
            stop_event.wait(timeout=0.1)


job_queue = JobQueue()
