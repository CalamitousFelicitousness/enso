"""Job types by the flow that keeps their record (src/lib/jobs/domains.ts holds the same table)."""

DOMAINS = {
    "generate": "generate",
    "detail": "generate",
    "cloud_image": "generate",
    "xyz-grid": "xyz-grid",
    "upscale": "upscale",
    "rembg": "rembg",
    "process": "process",
    "preprocess": "preprocess",
    "video": "video",
    "framepack": "framepack",
    "ltx": "ltx",
    "cloud_video": "video",
}

# Domains whose results reach a strip in the browser
STRIP_DOMAINS = frozenset({"generate", "video", "framepack", "ltx"})


def domain_of(job_type: str) -> str | None:
    """The domain of a job type; None for a type no record is kept for."""
    return DOMAINS.get(job_type)
