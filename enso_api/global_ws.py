import asyncio

from fastapi import WebSocket, WebSocketDisconnect
from modules.logger import log
from starlette.websockets import WebSocketState

from enso_api.util import job_progress, preview_image


class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)
        log.debug(f"WebSocket: connected clients={len(self.active)}")

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)
        log.debug(f"WebSocket: disconnected clients={len(self.active)}")

    async def send_json(self, ws: WebSocket, data: dict):
        if ws.client_state == WebSocketState.CONNECTED:
            try:
                await ws.send_json(data)
            except Exception:
                self.disconnect(ws)

    async def send_bytes(self, ws: WebSocket, data: bytes):
        if ws.client_state == WebSocketState.CONNECTED:
            try:
                await ws.send_bytes(data)
            except Exception:
                self.disconnect(ws)


manager = ConnectionManager()


async def push_progress(ws: WebSocket):
    from modules import shared

    from enso_api.job_queue import job_queue

    last_step = -1
    last_job = ""
    last_textinfo = None
    last_preview = shared.state.current_image
    last_download_snapshot = None
    while ws.client_state == WebSocketState.CONNECTED:
        try:
            state = shared.state
            current_step = state.sampling_step
            current_job = state.job
            current_textinfo = state.textinfo
            changed = current_step != last_step or current_job != last_job or current_textinfo != last_textinfo
            # A nested sdnext task's end() zeroes job_count mid-job, so Enso's own job counts as busy
            busy = state.job_count > 0 or job_queue.running_job_id is not None
            if busy and changed:
                last_step = current_step
                last_job = current_job
                last_textinfo = current_textinfo
                status = state.status()
                data = status.dict() if hasattr(status, "dict") else status.model_dump()
                data["step"] = current_step
                data["steps"] = state.sampling_steps
                data["progress"], data["eta"] = job_progress(state, status)
                data["textinfo"] = current_textinfo
                await manager.send_json(ws, {"type": "progress", "data": data})
            elif not busy and (last_step != -1 or last_job != ""):
                last_step = -1
                last_job = ""
                last_textinfo = None
                status = state.status()
                await manager.send_json(ws, {"type": "status", "data": status.dict() if hasattr(status, "dict") else status.model_dump()})
            # A step's preview is decoded after the step changes, and sdnext resets id_live_preview
            # on every begin(), so a new image object is the signal, checked on every tick
            if busy and state.current_image is not None and state.current_image is not last_preview:
                last_preview = state.current_image
                await manager.send_bytes(ws, await asyncio.to_thread(preview_image, last_preview))
            # Push download progress when downloads are active
            try:
                from modules.civitai.download_civitai import download_manager

                active = download_manager.get_active_items()
                if active or last_download_snapshot:
                    snapshot = str(active)
                    if snapshot != last_download_snapshot:
                        last_download_snapshot = snapshot if active else None
                        await manager.send_json(ws, {"type": "download", "data": active})
            except ImportError:
                pass
        except Exception as e:
            log.debug(f"WebSocket push error: {e}")
            break
        await asyncio.sleep(0.1)


async def handle_command(ws: WebSocket, data: dict):
    from modules import shared

    msg_type = data.get("type", "")
    if msg_type in ("interrupt", "skip"):
        from enso_api.job_queue import job_queue

        job_queue.note_user_stop()
    if msg_type == "interrupt":
        shared.state.interrupt()
        await manager.send_json(ws, {"type": "ack", "data": {"command": "interrupt"}})
    elif msg_type == "skip":
        shared.state.skip()
        await manager.send_json(ws, {"type": "ack", "data": {"command": "skip"}})
    elif msg_type == "download_cancel":
        download_id = data.get("id", "")
        if download_id:
            try:
                from modules.civitai.download_civitai import download_manager

                result = download_manager.cancel(download_id)
                await manager.send_json(ws, {"type": "ack", "data": {"command": "download_cancel", "id": download_id, "success": result}})
            except ImportError:
                await manager.send_json(ws, {"type": "ack", "data": {"command": "download_cancel", "id": download_id, "success": False}})
    elif msg_type == "ping":
        await manager.send_json(ws, {"type": "pong"})


async def ws_endpoint(ws: WebSocket):
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
    await manager.connect(ws)
    push_task = None
    try:
        push_task = asyncio.create_task(push_progress(ws))
        while True:
            data = await ws.receive_json()
            await handle_command(ws, data)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.debug(f"WebSocket error: {e}")
    finally:
        manager.disconnect(ws)
        if push_task:
            push_task.cancel()


def register_ws(app):
    app.add_api_websocket_route("/sdapi/v2/ws", ws_endpoint)
    log.debug("WebSocket: registered /sdapi/v2/ws")
