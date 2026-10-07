"""Image processors run before generation, so the map the page shows is the map the pipeline receives."""

import copy

from PIL import Image

from enso_api.job_warnings import JobLogCapture

# Bump when the runner changes what a map looks like for the same picture and parameters
REVISION = "1"
# Transparent pixels are laid over this before a processor sees them
BACKGROUND = "black"

# Every processor's default parameters as they were at boot; the Gradio control UI edits the live table
defaults: dict[str, dict] = {}


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
