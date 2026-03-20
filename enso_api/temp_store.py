"""Temporary image staging for jobs with save_images=False.

Images are saved to per-job subdirectories under a staging root and
served via the same ``/jobs/{id}/images/{index}`` endpoint as gallery-
saved images.  A periodic sweep removes directories whose mtime
exceeds the TTL (default 1 hour).
"""

import os
import shutil
import time

from PIL import Image

state: dict = {'root': None, 'ttl': 3600}


def init(root_dir: str, ttl_seconds: int = 3600) -> None:
    state['root'] = root_dir
    state['ttl'] = ttl_seconds
    os.makedirs(root_dir, exist_ok=True)


def stage_image(job_id: str, index: int, image: Image.Image, fmt: str = 'png') -> dict | None:
    if state['root'] is None:
        return None
    job_dir = os.path.join(state['root'], job_id)
    os.makedirs(job_dir, exist_ok=True)
    fmt = fmt.lower()
    save_fmt = {'jpg': 'JPEG', 'jpeg': 'JPEG', 'webp': 'WebP', 'jxl': 'JXL'}.get(fmt, 'PNG')
    ext = {'jpeg': 'jpg'}.get(fmt, fmt)
    path = os.path.join(job_dir, f'{index}.{ext}')
    image.save(path, format=save_fmt)
    return {
        'path': path,
        'width': image.width,
        'height': image.height,
        'format': ext,
        'size': os.path.getsize(path),
    }


def get_staging_dir() -> str | None:
    return state['root']


def cleanup_expired() -> int:
    if state['root'] is None or not os.path.isdir(state['root']):
        return 0
    now = time.time()
    removed = 0
    for name in os.listdir(state['root']):
        job_dir = os.path.join(state['root'], name)
        if not os.path.isdir(job_dir):
            continue
        if now - os.path.getmtime(job_dir) > state['ttl']:
            shutil.rmtree(job_dir, ignore_errors=True)
            removed += 1
    return removed
