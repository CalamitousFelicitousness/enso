"""V2 job-queue executor stubs for cloud job types.

The V2 job queue (``enso_api.job_queue``) keeps the ``cloud_image``,
``cloud_chat``, ``cloud_tts``, ``cloud_stt``, and ``cloud_video`` job
type registrations so the ``JobRequest`` union and the ``EXECUTORS`` dict
stay structurally aligned (verified by ``validate_registries``).

These executor stubs raise ``NotImplementedError`` at execution time.
They will be re-implemented as each phase of the cloud module rollout
lands its sdnext-core counterpart:

* Phase 1 (text): synchronous features call ``/sdapi/v1/cloud/*``
  directly from the frontend — no V2 job-queue path needed.
* Phase 2 (image): ``execute_cloud_image`` will dispatch to
  ``modules.cloud.image.generate_image``.
* Phase 3 (video): ``execute_cloud_video`` will dispatch to
  ``modules.cloud.video.generate_video``.
* Phase 4 (audio): ``execute_cloud_tts`` and ``execute_cloud_stt`` will
  dispatch to ``modules.cloud.audio.*``.

``cloud_chat`` is dead surface — chat is exposed via the V1 prompt-
enhance route, not as a V2 job type — but the stub remains until the
type itself is removed from ``JobRequest`` and ``EXECUTORS``.
"""


def execute_cloud_image(params: dict, job_id: str) -> dict:
    raise NotImplementedError("cloud_image executor stubbed during Phase 1 cloud cutover; modules.cloud.image lands in Phase 2")


def execute_cloud_chat(params: dict, job_id: str) -> dict:
    raise NotImplementedError("cloud_chat is not exposed via the V2 job queue; use POST /sdapi/v1/cloud/prompt-enhance for the synchronous text surface")


def execute_cloud_tts(params: dict, job_id: str) -> dict:
    raise NotImplementedError("cloud_tts executor stubbed during Phase 1 cloud cutover; modules.cloud.audio.tts lands in Phase 4")


def execute_cloud_stt(params: dict, job_id: str) -> dict:
    raise NotImplementedError("cloud_stt executor stubbed during Phase 1 cloud cutover; modules.cloud.audio.stt lands in Phase 4")


def execute_cloud_video(params: dict, job_id: str) -> dict:
    raise NotImplementedError("cloud_video executor stubbed during Phase 1 cloud cutover; modules.cloud.video lands in Phase 3")
