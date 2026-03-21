"""Shared helpers for the Enso API."""

import os


def is_model_cached(repo_id: str) -> bool:
    """Check if a HuggingFace model repo exists in the local cache."""
    if not repo_id:
        return False
    from modules import shared
    cache_folder = 'models--' + repo_id.replace('/', '--')
    for cache_dir in [shared.opts.hfcache_dir, shared.opts.diffusers_dir]:
        if os.path.isdir(os.path.join(cache_dir, cache_folder, 'snapshots')):
            return True
    return False
