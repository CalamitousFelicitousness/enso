import asyncio
import contextlib
import io
import json
import os
import shutil
import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor

from enso_api.job_store import JobStore
from enso_api.models import JobResult
from enso_api.ws_models import (
    WsEventCompleted,
    WsEventError,
    WsEventProgress,
    WsEventStages,
    WsEventStatus,
)

OUTPUT_URL_PREFIX = "/sdapi/v2/outputs"

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
    from modules.logger import log

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
    from modules.logger import log

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


GITIGNORE_SENTINEL = "# Enso runtime state, not part of the sdnext tree.\n*\n"


def mark_dir_git_ignored(path: str) -> None:
    """Write a self-ignoring .gitignore into Enso's state dir.

    sdnext force-includes <data_path>/data and then excludes its own state
    files one at a time by name, so a directory an extension creates is
    untracked-and-visible in the checkout. A lone '*' covers the whole
    directory including the sentinel itself, so nothing here reaches git.

    Written only when missing or empty: a populated file is someone's
    deliberate edit, and this is hygiene, so a failure to write it must not
    interrupt boot. Deliberately no CACHEDIR.TAG, which would tell backup
    tools this directory is regenerable.
    """
    target = os.path.join(path, ".gitignore")
    try:
        if os.path.exists(target) and os.path.getsize(target) > 0:
            return
        with open(target, "w", encoding="utf-8") as f:
            f.write(GITIGNORE_SENTINEL)
    except OSError as e:
        from modules.logger import log

        log.debug(f"Job queue: could not write {target}: {e}")


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


class JobQueue:
    def __init__(self):
        self.store: JobStore | None = None
        self._worker_thread: threading.Thread | None = None
        self._cloud_pool: ThreadPoolExecutor | None = None
        self._job_event = threading.Event()
        self._cancel_ids: set[str] = set()
        self._subscribers: dict[str, list[asyncio.Queue]] = {}
        self._sub_lock = threading.Lock()
        self._current_job_id: str | None = None
        self._initialized = False
        self.output_register_failures = 0

    def init(self, data_path: str, legacy_path: str | None = None) -> None:
        if self._initialized:
            return
        db_path = os.path.join(data_path, "jobs.db")
        if legacy_path:
            migrate_db_files(os.path.join(legacy_path, "jobs.db"), db_path)
        self.store = JobStore(db_path)
        mark_dir_git_ignored(data_path)
        self._recover_stale_jobs()
        self._worker_thread = threading.Thread(target=self._worker_loop, daemon=True, name="v2-job-worker")
        self._worker_thread.start()
        self._cloud_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="cloud-worker")
        self._initialized = True

    def _recover_stale_jobs(self):
        if self.store is None:
            return
        jobs, _ = self.store.list(status="running", limit=100)
        for job in jobs:
            self.store.update_status(job["id"], "failed", error="Server restarted", completed_at=JobStore.now())

    def submit(self, job_type: str, params: dict, priority: int = 0) -> dict:
        job = self.store.create(job_type=job_type, params=params, priority=priority)
        self._job_event.set()
        return job

    def cancel(self, job_id: str) -> bool:
        job = self.store.get(job_id)
        if job is None:
            return False
        if job["status"] == "running":
            from enso_api.executors import EXECUTORS

            entry = EXECUTORS.get(job["type"])
            if entry and entry["lock"]:
                self._cancel_ids.add(job_id)
                try:
                    from modules import shared

                    shared.state.interrupt()
                except Exception:
                    pass
            else:
                self.store.update_status(job_id, "cancelled", completed_at=JobStore.now())
                self.push_progress(job_id, WsEventStatus(status="cancelled").model_dump(exclude_none=True))
            return True
        if job["status"] == "pending":
            return self.store.cancel(job_id)
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
        from modules.logger import log

        log.debug("Job queue: worker started")
        cleanup_counter = 0
        while True:
            self._job_event.wait(timeout=1.0)
            self._job_event.clear()
            if self.store is None:
                continue
            cleanup_counter += 1
            if cleanup_counter >= 300:  # ~5 minutes
                cleanup_counter = 0
                self._periodic_cleanup()
            job = self.store.next_pending()
            if job is None:
                continue
            self._execute_job(job)

    def _periodic_cleanup(self) -> None:
        from modules.logger import log

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
        from modules.logger import log

        from enso_api.executors import EXECUTORS

        job_id = job["id"]
        job_type = job["type"]
        entry = EXECUTORS.get(job_type)
        if entry is None:
            log.error(f"Job queue: unknown type={job_type} id={job_id}")
            self.store.update_status(job_id, "failed", error=f"Unknown job type: {job_type}", completed_at=JobStore.now())
            return

        if entry["lock"]:
            self._run_local_job(job, entry["fn"], job_type, hold_lock=entry["lock"] is True)
        else:
            # Flip to 'running' synchronously before pool dispatch so the worker
            # loop can't see this row as pending and double-dispatch it.
            self.store.update_status(job["id"], "running", started_at=JobStore.now())
            job["status"] = "running"
            self._cloud_pool.submit(self._run_cloud_job, job, entry["fn"], job_type)
            if self.store.next_pending():
                self._job_event.set()

    def _run_local_job(self, job: dict, executor_fn, job_type: str, hold_lock: bool = True) -> None:
        from modules import shared
        from modules.logger import log

        job_id = job["id"]
        self._current_job_id = job_id
        log.info(f"Job queue: executing id={job_id} type={job_type}")
        self.store.update_status(job_id, "running", started_at=JobStore.now())
        self.push_progress(job_id, WsEventStatus(status="running").model_dump(exclude_none=True))

        raw_params = job.get("params", {})
        if isinstance(raw_params, str):
            raw_params = json.loads(raw_params)
        stages = compute_stages(job_type, raw_params)
        if stages:
            self.push_progress(job_id, WsEventStages(stages=stages).model_dump(exclude_none=True))

        # When the client opts out of live previews, disable_preview is the single
        # chokepoint: do_set_current_image() short-circuits before the latent decode,
        # which silences the poller below, the global /ws push, and nextjob() at once.
        shared.state.disable_preview = not raw_params.get("live_previews", True)

        poller_stop = threading.Event()
        poller = threading.Thread(target=self._progress_poller, args=(job_id, poller_stop, stages), daemon=True, name=f"v2-progress-{job_id[:8]}")
        poller.start()

        try:
            from modules.call_queue import queue_lock

            # hold_lock=False for executors whose sdnext entry point acquires
            # queue_lock internally; serialization still holds, just one level down
            with queue_lock if hold_lock else contextlib.nullcontext():
                if job_id in self._cancel_ids:
                    self._cancel_ids.discard(job_id)
                    self.store.update_status(job_id, "cancelled", completed_at=JobStore.now())
                    self.push_progress(job_id, WsEventStatus(status="cancelled").model_dump(exclude_none=True))
                    return
                params = job.get("params", {})
                if isinstance(params, str):
                    params = json.loads(params)
                result = executor_fn(params, job_id)
            self.output_register_failures += assign_output_urls(self.store, result, job_id)
            result_json = json.dumps(result, default=str)
            self.store.update_status(job_id, "completed", completed_at=JobStore.now(), result=result_json)
            self.push_progress(job_id, WsEventCompleted(result=JobResult.from_result_dict(result)).model_dump(exclude_none=True))
            log.info(f"Job queue: completed id={job_id}")
        except Exception as e:
            # Typed rejections (VideoError-style, code with HTTP semantics)
            # are expected client errors: one line, no traceback
            code = getattr(e, "code", None)
            if isinstance(code, int) and 400 <= code < 500:
                log.info(f"Job queue: rejected id={job_id} type={job_type} code={code} error={e}")
            else:
                from modules import errors

                errors.display(e, f"Job queue: {job_type}")
            error_msg = f"{type(e).__name__}: {e}"
            self.store.update_status(job_id, "failed", completed_at=JobStore.now(), error=error_msg)
            self.push_progress(job_id, WsEventError(error=error_msg).model_dump(exclude_none=True))
            if job_id in self._cancel_ids:
                self._cancel_ids.discard(job_id)
                self.store.update_status(job_id, "cancelled", completed_at=JobStore.now())
                self.push_progress(job_id, WsEventStatus(status="cancelled").model_dump(exclude_none=True))
        finally:
            poller_stop.set()
            poller.join(timeout=2.0)
            shared.state.disable_preview = False
            self._current_job_id = None
            if self.store.next_pending():
                self._job_event.set()

    def _run_cloud_job(self, job: dict, executor_fn, job_type: str) -> None:
        from modules.logger import log

        job_id = job["id"]
        log.info(f"Job queue: cloud executing id={job_id} type={job_type}")
        self.push_progress(job_id, WsEventStatus(status="running").model_dump(exclude_none=True))

        try:
            params = job.get("params", {})
            if isinstance(params, str):
                params = json.loads(params)
            result = executor_fn(params, job_id)
            self.output_register_failures += assign_output_urls(self.store, result, job_id)
            result_json = json.dumps(result, default=str)
            self.store.update_status(job_id, "completed", completed_at=JobStore.now(), result=result_json)
            self.push_progress(job_id, WsEventCompleted(result=JobResult.from_result_dict(result)).model_dump(exclude_none=True))
            log.info(f"Job queue: cloud completed id={job_id}")
        except Exception as e:
            log.error(f"Job queue: cloud failed id={job_id} {type(e).__name__}: {e}")
            error_msg = f"{type(e).__name__}: {e}"
            self.store.update_status(job_id, "failed", completed_at=JobStore.now(), error=error_msg)
            self.push_progress(job_id, WsEventError(error=error_msg).model_dump(exclude_none=True))

    def _progress_poller(self, job_id: str, stop_event: threading.Event, stages: list[str] | None = None) -> None:
        from modules import shared

        last_step = -1
        last_job = ""
        last_textinfo = None
        last_preview_id = -1
        # Stage tracking state
        stage_index = 0
        stage_name = stages[0] if stages else ""
        phase = None
        while not stop_event.is_set():
            try:
                if self._current_job_id != job_id:
                    break
                state = shared.state
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
                    progress_val = status.progress if hasattr(status, "progress") else 0
                    eta_val = status.eta if hasattr(status, "eta") else None
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
                    # Send preview image as binary if available
                    if state.id_live_preview != last_preview_id and state.current_image is not None:
                        last_preview_id = state.id_live_preview
                        try:
                            buf = io.BytesIO()
                            state.current_image.save(buf, format="JPEG", quality=75)
                            self._push_binary(job_id, buf.getvalue())
                        except Exception:
                            pass
            except Exception:
                pass
            stop_event.wait(timeout=0.1)


job_queue = JobQueue()
