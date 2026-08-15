"""Video result helpers shared by the video executors.

The saved container is the only honest source for playback fps, duration,
and dimensions: generation cores report throughput or pre-snap sizes, and
interpolation changes the save rate after the fact.
"""

import os

from modules.logger import log


def probe_video_file(path: str) -> dict:
    """Container metadata: width, height, fps, frames, duration, has_audio; zero-valued keys on probe failure."""
    info = {"width": 0, "height": 0, "fps": 0.0, "frames": 0, "duration": 0.0, "has_audio": False}
    try:
        # direct import: video_utils.check_av() would trigger a pip install
        import av
    except Exception:
        return info
    try:
        with av.open(path, metadata_errors="ignore") as container:
            if container.streams.video:
                stream = container.streams.video[0]
                ctx = stream.codec_context
                info["width"] = int(ctx.width or 0)
                info["height"] = int(ctx.height or 0)
                rate = stream.average_rate or stream.base_rate
                info["fps"] = round(float(rate), 3) if rate else 0.0
                info["frames"] = int(stream.frames or 0)
            if container.duration:
                info["duration"] = round(container.duration / av.time_base, 3)
            info["has_audio"] = len(container.streams.audio) > 0
    except Exception as e:
        log.warning(f"Video probe failed: {path}: {e}")
    if not info["duration"] and info["fps"] > 0 and info["frames"]:
        info["duration"] = round(info["frames"] / info["fps"], 3)
    if not info["frames"] and info["fps"] > 0 and info["duration"]:
        info["frames"] = round(info["duration"] * info["fps"])
    return info


def sibling_thumb(path: str) -> str | None:
    """The `<base>.thumb.jpg` written by video_save.save_thumbnail, if present."""
    thumb = os.path.splitext(path)[0] + ".thumb.jpg"
    return thumb if os.path.isfile(thumb) else None


def build_video_ref(job_id: str, index: int, path: str, *, probe: dict | None = None, thumb_path: str | None = None, width: int = 0, height: int = 0, fps: float = 0.0, frames: int = 0) -> dict:
    """A VideoRef-shaped dict for one saved video; probed values win over the caller's hints."""
    if probe is None:
        probe = probe_video_file(path)
    width = probe["width"] or width
    height = probe["height"] or height
    fps = probe["fps"] or fps
    frames = probe["frames"] or frames
    duration = probe["duration"] or (round(frames / fps, 3) if fps > 0 and frames else None)
    if thumb_path is None:
        thumb_path = sibling_thumb(path)
    ext = os.path.splitext(path)[1].lstrip(".").lower()
    return {
        "index": index,
        "path": path,
        "thumbnail_path": thumb_path,
        "url": f"/sdapi/v2/jobs/{job_id}/videos/{index}",
        "thumbnail_url": f"/sdapi/v2/jobs/{job_id}/videos/{index}/thumbnail" if thumb_path else None,
        "width": width,
        "height": height,
        "format": ext or "mp4",
        "size": os.path.getsize(path),
        "duration": duration or None,
    }
