"""A route class that bounds a JSON body by its declared length before FastAPI reads it whole."""

import logging
from collections.abc import Callable, Coroutine
from typing import Any

from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from starlette.requests import Request
from starlette.responses import Response

from enso_api.errors import refuse

log = logging.getLogger("sd")

BODY_LIMIT = 64 << 20
LABEL = "Enso API"


class BoundedRoute(APIRoute):
    """Only a route that declares a body is checked; a chunked body without a length is refused, a bodiless request passes.

    Validation errors are logged here, since the paths on such routers have sdnext's logging off.
    """

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handler = super().get_route_handler()
        if self.body_field is None:
            return handler

        async def bounded(request: Request) -> Response:
            length = request.headers.get("content-length")
            if length is None and "chunked" in request.headers.get("transfer-encoding", "").lower():
                refuse(411, "length_required", "A request body needs a Content-Length header", label=LABEL)
            if length is not None and length.isdigit() and int(length) > BODY_LIMIT:
                refuse(413, "body_too_large", f"The request body is {int(length)} bytes, over the limit of {BODY_LIMIT}", label=LABEL, size=int(length), limit=BODY_LIMIT)
            try:
                return await handler(request)
            except RequestValidationError as e:
                places = ", ".join(".".join(str(part) for part in error.get("loc", ())) for error in e.errors()[:5])
                log.info(f"{LABEL}: refused status=422 path={request.url.path} at {places}")
                raise

        return bounded
