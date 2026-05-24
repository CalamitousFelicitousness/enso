import asyncio
import contextlib
import json

from fastapi import WebSocket, WebSocketDisconnect
from modules.logger import log

from enso_api.ws_models import (
    WsEventAck,
    WsEventCancelled,
    WsEventCompleted,
    WsEventError,
    WsEventPing,
    WsEventStatus,
)


async def ws_job_endpoint(ws: WebSocket, job_id: str):
    from modules import shared

    if shared.cmd_opts.auth or shared.cmd_opts.auth_file:
        try:
            from modules.api.security import ws_tickets
        except ImportError:
            from enso_api.security_stubs import ws_tickets
        ticket = ws.query_params.get("ticket")
        if not ticket or not ws_tickets.validate(ticket):
            await ws.close(code=1008, reason="Invalid or expired ticket")
            return

    from enso_api.job_queue import job_queue

    job = job_queue.store.get(job_id)
    if job is None:
        await ws.close(code=4004, reason="Job not found")
        return

    await ws.accept()
    queue = job_queue.subscribe(job_id)
    log.debug(f"Job WebSocket: connected job={job_id}")

    try:
        # Send current state immediately
        await ws.send_json(WsEventStatus(status=job["status"], progress=job.get("progress", 0.0)).model_dump(exclude_none=True))

        # If already terminal, send result and close
        if job["status"] in ("completed", "failed", "cancelled"):
            if job["status"] == "completed" and job.get("result"):
                result = job["result"]
                if isinstance(result, str):
                    result = json.loads(result)
                await ws.send_json(WsEventCompleted(result=result).model_dump(exclude_none=True))
            elif job["status"] == "failed":
                await ws.send_json(WsEventError(error=job.get("error", "")).model_dump(exclude_none=True))
            elif job["status"] == "cancelled":
                await ws.send_json(WsEventCancelled().model_dump(exclude_none=True))
            await ws.close()
            return

        # Listen for client commands in a background task
        async def listen_commands():
            try:
                while True:
                    data = await ws.receive_json()
                    msg_type = data.get("type", "")
                    if msg_type == "interrupt":
                        from modules import shared

                        shared.state.interrupt()
                        await ws.send_json(WsEventAck(command="interrupt").model_dump(exclude_none=True))
                    elif msg_type == "skip":
                        from modules import shared

                        shared.state.skip()
                        await ws.send_json(WsEventAck(command="skip").model_dump(exclude_none=True))
            except (WebSocketDisconnect, Exception):
                pass

        cmd_task = asyncio.create_task(listen_commands())

        # Stream events from the subscriber queue
        try:
            while True:
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=30.0)
                except asyncio.TimeoutError:
                    await ws.send_json(WsEventPing().model_dump(exclude_none=True))
                    continue

                if isinstance(msg, bytes):
                    await ws.send_bytes(msg)
                elif isinstance(msg, dict):
                    await ws.send_json(msg)
                    if msg.get("type") in ("completed", "error", "cancelled"):
                        break
        finally:
            cmd_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await cmd_task

    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.debug(f"Job WebSocket error: job={job_id} {e}")
    finally:
        job_queue.unsubscribe(job_id, queue)
        log.debug(f"Job WebSocket: disconnected job={job_id}")
