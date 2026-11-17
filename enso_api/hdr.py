"""HDR files beside saved outputs, written by sdnext's HDR step (scripts.hdr.hdr_process).

sdnext's HDR script writes only when sdnext saves the output, and execute_process
saves image and batch outputs itself, so those runs call the step here.
"""

import dataclasses
import os
import subprocess

from modules.logger import log

from enso_api.job_models import ProcessHdrParams
from enso_api.models import ItemHdrSupportV2


def formats() -> list[ItemHdrSupportV2]:
    """What the step writes for each image file format the server offers; empty without the step."""
    try:
        from scripts.hdr.hdr_process import hdr_support
    except ImportError:
        return []
    from modules import shared

    info = shared.opts.data_labels.get("samples_format")
    args = getattr(info, "component_args", None)
    choices = (args() if callable(args) else args or {}).get("choices") or [shared.opts.samples_format]
    return [ItemHdrSupportV2(**dataclasses.asdict(hdr_support(fmt))) for fmt in choices]


def write(saved: list[tuple[object, str]], params: dict) -> list[str]:
    """The HDR file of each saved output, written beside it; what is not written is logged."""
    try:
        from scripts.hdr.hdr_process import HDRUnavailable, convert_hdr
    except ImportError:
        log.warning("HDR: no HDR file was written: this sdnext has no HDR step")
        return []
    hdr = ProcessHdrParams.model_validate(params)
    written = []
    for image, path in saved:
        try:
            written.append(convert_hdr(image, path, hdr.hdr_method, hdr.hdr_peak, hdr.hdr_gamut))
        except (HDRUnavailable, ValueError) as e:
            # the format, its encoder and the settings are the same for every output
            log.warning(f"HDR: no HDR file was written: {str(e).removeprefix('HDR: ')}")
            break
        except (OSError, subprocess.CalledProcessError) as e:
            log.warning(f'HDR: no HDR file for "{path}": {e}')
    return written


def note(written: list[str]) -> str:
    """The HDR files a run wrote, for its info line."""
    return f"HDR: {os.path.basename(written[0])}" if len(written) == 1 else f"HDR: {len(written)} files"


def after_save(params: dict, mode: str, save_output: bool, saved: list[tuple[object, str]], info: str) -> str:
    """Write the HDR files a Process run asked for; its info line, naming them."""
    if mode not in ("image", "batch"):
        log.warning(f"HDR: no HDR file was written: a {mode} run takes no HDR")
        return info
    if not save_output:
        log.warning("HDR: no HDR file was written: the output is not saved")
        return info
    written = write(saved, params)
    if not written:
        return info
    return ", ".join(part for part in (info.rstrip(", "), note(written)) if part)
