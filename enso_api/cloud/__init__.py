"""Enso V2 cloud subpackage.

Cloud provider registry, transport, adapter, and presets live in
``modules.cloud`` (sdnext core). This subpackage
is intentionally minimal post-tear-down - it retains only the V2-specific
job-queue executor stubs (``executor.py``) and the Pydantic request
shapes used by the V2 ``JobRequest`` union (``models.py``).

For provider CRUD, model lists, and the synchronous text features
(prompt-enhance, caption, VQA), call ``/sdapi/v1/cloud/*`` directly or
import from ``modules.cloud``.
"""
