"""Miscellaneous v2 routes extracted from modules/api/api.py.

Contains HuggingFace settings, extra-networks detail, and WS-ticket endpoints.
"""

from datetime import datetime
from modules import shared
from modules.logger import log


# ---------------------------------------------------------------------------
# HuggingFace settings
# ---------------------------------------------------------------------------

def get_hf_settings():
    """Return HuggingFace token configuration status."""
    from modules import secrets_manager
    return {
        "token_configured": secrets_manager.has('huggingface_token', 'HF_TOKEN'),
    }


def post_hf_settings(request: dict):
    """Validate and store a HuggingFace token."""
    import os
    from starlette.responses import JSONResponse
    from modules import secrets_manager
    token = request.get('token')
    if token is not None:
        token = token.strip()
        if token:
            try:
                import huggingface_hub as hf
                user = hf.whoami(token=token)
                log.info(f'HuggingFace token validated: user={user.get("name", "?")}')
            except Exception:
                return JSONResponse(content={"error": "Invalid token"}, status_code=400)
        secrets_manager.set('huggingface_token', token)
        if token:
            os.environ['HF_TOKEN'] = token
            try:
                import huggingface_hub as hf
                hf.login(token=token, add_to_git_credential=False)
            except Exception:
                pass
        else:
            os.environ.pop('HF_TOKEN', None)
    return get_hf_settings()


def get_hf_profile():
    """Return HuggingFace profile for the configured token."""
    from starlette.responses import JSONResponse
    from modules import secrets_manager
    token = secrets_manager.get('huggingface_token', 'HF_TOKEN')
    if not token:
        return JSONResponse(content={"error": "not authenticated"}, status_code=401)
    try:
        import huggingface_hub as hf
        user = hf.whoami(token=token)
        return {
            "username": user.get("name", ""),
            "fullname": user.get("fullname", ""),
            "avatar": user.get("avatarUrl", ""),
        }
    except Exception:
        return JSONResponse(content={"error": "token invalid or expired"}, status_code=401)


# ---------------------------------------------------------------------------
# Extra-networks detail
# ---------------------------------------------------------------------------

def _format_tags(raw_tags):
    if isinstance(raw_tags, dict):
        return '|'.join(raw_tags.keys()) if raw_tags else None
    if isinstance(raw_tags, str) and raw_tags:
        return raw_tags
    return None


def get_extra_network_detail(page: str, name: str):
    """Get detailed metadata for a single extra network item."""
    for pg in shared.extra_networks:
        if pg.name.lower() != page.lower():
            continue
        for item in pg.items:
            if item.get('name', '').lower() != name.lower():
                continue
            mtime = item.get('mtime', None)
            if isinstance(mtime, datetime):
                mtime = mtime.isoformat()
            elif mtime is not None:
                mtime = str(mtime)
            return {
                'name': item.get('name', ''),
                'type': pg.name,
                'title': item.get('title', None),
                'filename': item.get('filename', None),
                'hash': item.get('shorthash', None) or item.get('hash'),
                'alias': item.get('alias', None),
                'size': item.get('size', None),
                'mtime': mtime,
                'version': item.get('version', None),
                'tags': _format_tags(item.get('tags', None)),
                'description': item.get('description', None),
                'info': item.get('info', None) if isinstance(item.get('info'), dict) else None,
            }
    return {}


def get_extra_network_details(page: str | None = None, name: str | None = None, filename: str | None = None, title: str | None = None, fullname: str | None = None, hash: str | None = None, offset: int = 0, limit: int = 50):  # pylint: disable=redefined-builtin
    """Batch-fetch full detail for extra network items with optional filtering and pagination."""
    matched = []
    for pg in shared.extra_networks:
        if page is not None and pg.name != page.lower():
            continue
        for item in pg.items:
            if name is not None and item.get('name', '') != name:
                continue
            if title is not None and item.get('title', '') != title:
                continue
            if filename is not None and item.get('filename', '') != filename:
                continue
            if fullname is not None and item.get('fullname', '') != fullname:
                continue
            if hash is not None and (item.get('shorthash', None) or item.get('hash')) != hash:
                continue
            mtime = item.get('mtime', None)
            if isinstance(mtime, datetime):
                mtime = mtime.isoformat()
            elif mtime is not None:
                mtime = str(mtime)
            matched.append({
                'name': item.get('name', ''),
                'type': pg.name,
                'title': item.get('title', None),
                'fullname': item.get('fullname', None),
                'filename': item.get('filename', None),
                'hash': item.get('shorthash', None) or item.get('hash'),
                'preview': item.get('preview', None),
                'alias': item.get('alias', None),
                'size': item.get('size', None),
                'mtime': mtime,
                'version': item.get('version', None),
                'tags': _format_tags(item.get('tags', None)),
                'description': item.get('description', None),
                'info': item.get('info', None) if isinstance(item.get('info'), dict) else None,
            })
    total = len(matched)
    return {
        'items': matched[offset:offset + limit],
        'total': total,
        'offset': offset,
        'limit': limit,
    }


# ---------------------------------------------------------------------------
# WS ticket
# ---------------------------------------------------------------------------

def post_ws_ticket():
    """Create a one-time WebSocket authentication ticket."""
    try:
        from modules.api.security import ws_tickets
    except ImportError:
        from enso_api.security_stubs import ws_tickets
    return {"ticket": ws_tickets.create()}


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def register_misc_routes(app, add_route):
    """Register miscellaneous v2 routes via the shared add_api_route helper."""
    from modules.api.models import ItemExtraNetworkDetail, ResExtraNetworkDetails
    add_route("/sdapi/v2/huggingface/settings", get_hf_settings, methods=["GET"], tags=["HuggingFace"])
    add_route("/sdapi/v2/huggingface/settings", post_hf_settings, methods=["POST"], tags=["HuggingFace"])
    add_route("/sdapi/v2/huggingface/me", get_hf_profile, methods=["GET"], tags=["HuggingFace"])
    add_route("/sdapi/v2/extra-networks/detail", get_extra_network_detail, methods=["GET"], response_model=ItemExtraNetworkDetail, tags=["Enumerators"])
    add_route("/sdapi/v2/extra-networks/details", get_extra_network_details, methods=["GET"], response_model=ResExtraNetworkDetails, tags=["Enumerators"])
    add_route("/sdapi/v2/ws-ticket", post_ws_ticket, methods=["POST"], tags=["WebSocket"])
