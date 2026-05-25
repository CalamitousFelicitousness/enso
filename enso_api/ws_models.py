"""Strict Pydantic schema for per-job WebSocket events.

This module owns the event shapes emitted on ``/sdapi/v2/jobs/{job_id}/ws``.
The :data:`WsEvent` discriminated union is the contract between the
emission sites in :mod:`enso_api.ws`, :mod:`enso_api.job_queue`, and
:mod:`enso_api.cloud.executor` and the consumer narrowing in the
frontend (``useJobTracker`` switch on ``data.type``).

Frontend reference: ``src/api/types/v2.ts`` ``JobWsEvent`` union and the
``CloudJobPhase`` literal in ``src/api/types/cloud.ts``. Codegen mirrors
this Python schema into the TS side via :mod:`enso_api.routes`'s
``/jobs/ws-events`` documentation route -- both sides stay in lockstep
because the TS shape is generated from the OpenAPI snapshot.
"""

from typing import Annotated, Literal

from pydantic import Field

from enso_api.models import CloudJobPhase, JobResult, JobStatus, StrictBaseModel


class WsEventStatus(StrictBaseModel):
    """Lifecycle transition: status snapshot pushed when a job enters a new state."""

    type: Literal["status"] = "status"
    status: JobStatus
    progress: float = 0.0


class WsEventProgress(StrictBaseModel):
    """Sampling-step progress emitted ~10x/sec from the local-executor poller."""

    type: Literal["progress"] = "progress"
    step: int
    steps: int
    progress: float
    eta: float | None = None
    task: str | None = None
    textinfo: str | None = None
    stage: int | None = None
    stage_name: str | None = None
    stage_count: int | None = None
    phase: str | None = None


class WsEventCloudProgress(StrictBaseModel):
    """Phase-based progress for cloud executors (no fine-grained step counter)."""

    type: Literal["cloud_progress"] = "cloud_progress"
    phase: CloudJobPhase
    detail: str | None = None
    progress: float | None = None
    position: int | None = None
    elapsed: float | None = None


class WsEventStages(StrictBaseModel):
    """Predicted pipeline stages, sent once at the start of a generation job."""

    type: Literal["stages"] = "stages"
    stages: list[str]


class WsEventCompleted(StrictBaseModel):
    """Terminal event carrying the :class:`JobResult` payload."""

    type: Literal["completed"] = "completed"
    result: JobResult


class WsEventError(StrictBaseModel):
    """Terminal event signalling job failure with an error message."""

    type: Literal["error"] = "error"
    error: str


class WsEventCancelled(StrictBaseModel):
    """Terminal event signalling job cancellation."""

    type: Literal["cancelled"] = "cancelled"


class WsEventPing(StrictBaseModel):
    """Keepalive sent every 30 seconds when no other event is queued."""

    type: Literal["ping"] = "ping"


class WsEventAck(StrictBaseModel):
    """Acknowledgement of a client command (``interrupt`` or ``skip``)."""

    type: Literal["ack"] = "ack"
    command: str


WsEvent = Annotated[
    WsEventStatus | WsEventProgress | WsEventCloudProgress | WsEventStages | WsEventCompleted | WsEventError | WsEventCancelled | WsEventPing | WsEventAck,
    Field(discriminator="type"),
]
"""Discriminated union of per-job WS events. The ``type`` field narrows
to the matching variant on the TS consumer side via ``switch (event.type)``."""


if __name__ == "__main__":
    # Construction smoke: catches field-rename drift at import time. Each
    # variant is built with values matching the TS expectations.
    samples: list[StrictBaseModel] = [
        WsEventStatus(status="running", progress=0.0),
        WsEventProgress(step=5, steps=20, progress=0.25, eta=12.5, task="Base", stage=0, stage_name="Generate", stage_count=2, phase=None),
        WsEventCloudProgress(phase="processing", detail="Polling NanoGPT", progress=0.5, position=3, elapsed=8.0),
        WsEventStages(stages=["Generate", "Hires", "Detailer"]),
        WsEventCompleted(result=JobResult(images=[], processed=[], videos=[], info={}, params={})),
        WsEventError(error="ValueError: bad input"),
        WsEventCancelled(),
        WsEventPing(),
        WsEventAck(command="interrupt"),
    ]
    for sample in samples:
        print(sample.model_dump_json(exclude_none=True))
