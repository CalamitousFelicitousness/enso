"""What SD.Next declares its consumers resample pictures to, read through its accessors when this SD.Next has them."""

import logging
from collections.abc import Callable

from pydantic import ValidationError

from enso_api.models import DeclaredSizeV2

log = logging.getLogger("sd")

# The picture kinds the header reader names, by the extension Pillow registers each under
KIND_EXTENSIONS = {"png": ".png", "jpeg": ".jpg", "webp": ".webp", "gif": ".gif", "bmp": ".bmp", "tiff": ".tiff", "avif": ".avif", "heic": ".heic", "jp2": ".jp2", "jxl": ".jxl"}
CODEC_FEATURES = {"webp": "webp", "avif": "avif", "jp2": "jpg_2000"}

refused: set[str] = set()


def declared(name: str, read: Callable[[], object]) -> DeclaredSizeV2 | None:
    """An accessor's answer as a declaration; None when this SD.Next has no such accessor or answers in a shape this
    build does not know."""
    try:
        answer = read()
    except (ImportError, AttributeError):
        return None
    try:
        return DeclaredSizeV2.model_validate(answer)
    except ValidationError as e:
        if name not in refused:
            refused.add(name)
            log.warning(f"Size rules: {name} answered in an unknown shape, reported as undeclared: {answer!r}: {e.errors()[0]['msg']}")
        return None


def reference_size(model) -> DeclaredSizeV2 | None:
    def read():
        from modules.sd_models import get_condition_image_rule

        return get_condition_image_rule(model)

    return declared("reference size", read)


def ip_adapter_size(model) -> DeclaredSizeV2 | None:
    def read():
        from modules.ipadapter import get_image_encoder_rule

        return get_image_encoder_rule(model)

    return declared("IP-Adapter size", read)


def caption_size() -> DeclaredSizeV2 | None:
    def read():
        from modules.caption.caption import get_image_rule

        return get_image_rule()

    return declared("caption size", read)


def has_size_rules() -> bool:
    from modules import sd_models

    return hasattr(sd_models, "get_condition_image_rule")


def server_formats() -> list[str]:
    """The picture kinds this server's Pillow opens, with their codec built in."""
    from PIL import Image, features

    Image.init()
    registered = Image.registered_extensions()
    return [kind for kind, ext in KIND_EXTENSIONS.items() if ext in registered and (kind not in CODEC_FEATURES or features.check(CODEC_FEATURES[kind]))]
