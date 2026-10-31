"""Image processors run before generation, so the map the page shows is the map the pipeline receives."""

import copy
import json
from collections import OrderedDict

from PIL import Image

from enso_api.job_warnings import JobLogCapture

# Bump when the runner changes what a map looks like for the same picture and parameters
REVISION = "1"
# Transparent pixels are laid over this before a processor sees them
BACKGROUND = "black"
# Maps a later job can take instead of running the processor again
MAPS_KEPT = 256

# Every processor's default parameters as they were at boot; the Gradio control UI edits the live table
defaults: dict[str, dict] = {}
# The media store hash of each map made, by map_key, least recently used first
maps_made: OrderedDict[str, str] = OrderedDict()


class ProcessorFailed(Exception):
    """The processor returned no map of the picture; the reason says why."""

    logged = True

    def __init__(self, processor_id: str, reason: str):
        self.reason = f"{processor_id}: {reason}"
        self.detail = self.reason
        super().__init__(self.reason)


def snapshot_defaults() -> None:
    from modules.control import processors

    defaults.clear()
    for name, entry in processors.config.items():
        defaults[name] = copy.deepcopy(entry.get("params") or {})


def opaque(image: Image.Image) -> Image.Image:
    """RGB with transparent pixels laid over the background, not left to whatever sits under them."""
    if image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info):
        rgba = image.convert("RGBA")
        return Image.alpha_composite(Image.new("RGBA", rgba.size, BACKGROUND), rgba).convert("RGB")
    return image.convert("RGB")


def shared_processor(processor_id: str):
    """The processor instance sdnext's own API keeps, loaded for processor_id."""
    import modules.api.process as process_module
    from modules.control import processors

    proc = process_module.processor
    if proc is None or proc.processor_id != processor_id or proc.model is None:
        proc = processors.Processor(processor_id)
        process_module.processor = proc
    return proc


def run(processor_id: str, image: Image.Image, params: dict) -> Image.Image:
    """One processor over a complete parameter set; ProcessorFailed carries the reason."""
    from modules.logger import log

    if processor_id not in defaults:
        raise ProcessorFailed(processor_id, "unknown processor")
    unknown = sorted(set(params) - set(defaults[processor_id]))
    if unknown:
        raise ProcessorFailed(processor_id, f"unknown parameters: {', '.join(unknown)}")
    source = opaque(image)
    capture = JobLogCapture()
    log.addHandler(capture)
    try:
        proc = shared_processor(processor_id)
        result = proc(source, local_config={**defaults[processor_id], **params}) if proc.model is not None else None
    finally:
        log.removeHandler(capture)
    error = capture.first_error()
    if error:
        raise ProcessorFailed(processor_id, error)
    if not isinstance(result, Image.Image) or result is source:
        raise ProcessorFailed(processor_id, "returned no map")
    if result.size != source.size:
        raise ProcessorFailed(processor_id, f"returned {result.width}x{result.height} for a {source.width}x{source.height} picture")
    return result


def map_key(processor_id: str, params: dict, digest: str) -> str:
    """What makes a map: the processor with every parameter, the runner's revision and the picture's sha256."""
    complete = json.dumps({**defaults.get(processor_id, {}), **params}, sort_keys=True, default=str)
    return f"{processor_id}|{REVISION}|{complete}|{digest}"


def recall(key: str) -> str | None:
    """The hash of the map last made under key."""
    digest = maps_made.get(key)
    if digest is not None:
        maps_made.move_to_end(key)
    return digest


def remember(key: str, digest: str) -> None:
    maps_made[key] = digest
    maps_made.move_to_end(key)
    while len(maps_made) > MAPS_KEPT:
        maps_made.popitem(last=False)


def release() -> None:
    """After a step, as in sdnext's own control run: the processor is dropped when control_unload_processor is set."""
    import modules.api.process as process_module
    from modules import devices, shared
    from modules.control import processors

    proc = process_module.processor
    if proc is None or proc.model is None or not shared.opts.control_unload_processor:
        return
    if proc.processor_id in processors.config:
        processors.config[proc.processor_id]["dirty"] = True
    proc.model = None
    devices.torch_gc(force=True, reason="processor")
