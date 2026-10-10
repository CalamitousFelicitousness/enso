"""Browser sessions: the credential media loads and sockets carry.

An <img>, a <video> or a WebSocket cannot send an Authorization header, so
POST /session trades the credential sdnext admitted for an HttpOnly cookie
every same-origin load carries. A page on another origin gets the token for
?t= on GET media URLs and a single-use ticket per socket. Sessions live in
memory: a restart ends them and the browser asks again.
"""

import secrets
import threading
import time
from base64 import b64decode
from binascii import Error as Base64Error
from hmac import compare_digest
from typing import NamedTuple

from fastapi import APIRouter, HTTPException, Request, Response, WebSocket

from enso_api.models import ResSessionV2, ResWsTicketV2

SESSION_COOKIE = "enso-session"
SESSION_SECONDS = 24 * 3600
TICKET_SECONDS = 60


class Caller(NamedTuple):
    user: str | None


class Expiring:
    """Tokens that each admit a caller until a deadline; expired ones go on every issue."""

    def __init__(self, seconds: int, single_use: bool):
        self.seconds = seconds
        self.single_use = single_use
        self.items: dict[str, tuple[Caller, float]] = {}
        self.lock = threading.Lock()

    def issue(self, caller: Caller) -> tuple[str, float]:
        now = time.time()
        token = secrets.token_urlsafe(32)
        with self.lock:
            self.items = {key: item for key, item in self.items.items() if item[1] > now}
            self.items[token] = (caller, now + self.seconds)
        return token, now + self.seconds

    def resolve(self, token: str | None) -> Caller | None:
        if not token:
            return None
        with self.lock:
            item = self.items.pop(token, None) if self.single_use else self.items.get(token)
        if item is None or item[1] <= time.time():
            return None
        return item[0]


sessions = Expiring(SESSION_SECONDS, single_use=False)
tickets = Expiring(TICKET_SECONDS, single_use=True)


def credentials() -> dict[str, str]:
    from modules import shared

    return getattr(getattr(shared, "api", None), "credentials", None) or {}


def auth_required() -> bool:
    """Whether sdnext runs with --auth or --auth-file; one answer for routes and sockets."""
    return bool(credentials())


def login_tokens() -> dict[str, str]:
    """gradio's login tokens, each to its username."""
    from modules import shared

    app = getattr(getattr(shared, "api", None), "app", None)
    return getattr(app, "tokens", None) or {}


def basic_pair(header: str | None) -> tuple[str, str] | None:
    if not header or not header.lower().startswith("basic "):
        return None
    try:
        user, _, password = b64decode(header[6:], validate=True).decode("utf-8").partition(":")
    except (Base64Error, UnicodeDecodeError):
        return None
    return user, password


def authenticate(headers, cookies) -> Caller | None:
    """The caller sdnext's Api.auth admits (modules/api/api.py), with who it is; None for one it refuses."""
    known = credentials()
    if not known:
        return Caller(None)
    tokens = login_tokens()
    pair = basic_pair(headers.get("authorization"))
    if pair is not None and pair[0] in known:
        user, password = pair
        if compare_digest(password.encode("utf-8"), known[user].encode("utf-8")):
            return Caller(user)
        if password in tokens:
            return Caller(tokens[password])
    cookie = cookies.get("access_token") or cookies.get("access-token-unsecure")
    if cookie and cookie in tokens:
        return Caller(tokens[cookie])
    return None


def session_caller(connection: Request | WebSocket) -> Caller | None:
    return sessions.resolve(connection.cookies.get(SESSION_COOKIE))


async def media_auth(request: Request) -> None:
    """Admit a media load by its session cookie, by ?t= on a GET, or by what sdnext's auth admits.

    The 401 carries no Basic challenge, so a stale session makes the page renew it instead of prompting.
    """
    if not auth_required() or session_caller(request) is not None:
        return
    if request.method in ("GET", "HEAD") and sessions.resolve(request.query_params.get("t")) is not None:
        return
    if authenticate(request.headers, request.cookies) is not None:
        return
    raise HTTPException(status_code=401, detail="No session")


async def admit_socket(ws: WebSocket) -> bool:
    """Whether a socket's caller is admitted; a refused one is closed with 1008.

    The close follows an accept: a socket closed before it fails its handshake, and the browser sees 1006.
    """
    if not auth_required() or session_caller(ws) is not None:
        return True
    if tickets.resolve(ws.query_params.get("ticket")) is not None:
        return True
    if authenticate(ws.headers, ws.cookies) is not None:
        return True
    await ws.accept()
    await ws.close(code=1008, reason="No session")
    return False


def admitted(request: Request) -> Caller:
    """The caller behind a credential sdnext takes; 401 otherwise, whatever dependencies the route was mounted with."""
    caller = authenticate(request.headers, request.cookies)
    if caller is None:
        raise HTTPException(status_code=401, detail="No credential")
    return caller


router = APIRouter(prefix="/sdapi/v2", tags=["Session"])


@router.post("/session", response_model=ResSessionV2)
async def post_session(request: Request, response: Response):
    """Issue a session for the caller sdnext admitted, as the enso-session cookie and in the body."""
    if not auth_required():
        return ResSessionV2(required=False)
    # Traded only for a credential sdnext takes, never for another session
    caller = admitted(request)
    token, expires = sessions.issue(caller)
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_SECONDS,
        path="/",
        httponly=True,
        samesite="lax",
        secure=request.url.scheme == "https",
    )
    return ResSessionV2(required=True, token=token, expires_at=int(expires * 1000), user=caller.user)


@router.post("/ws-ticket", response_model=ResWsTicketV2, tags=["WebSocket"])
async def post_ws_ticket(request: Request):
    """A single-use ticket for one socket opened from another origin, valid 60 s."""
    ticket, _ = tickets.issue(admitted(request) if auth_required() else Caller(None))
    return ResWsTicketV2(ticket=ticket)
