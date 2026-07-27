"""Stub implementations for modules.api.security until it's available in core."""

import secrets


class WsTickets:
    """Simple WebSocket ticket manager."""

    def __init__(self):
        self.tickets = {}

    def create(self):
        ticket = secrets.token_urlsafe(32)
        self.tickets[ticket] = True
        return ticket

    def validate(self, ticket):
        return self.tickets.pop(ticket, False)


ws_tickets = WsTickets()


def validate_download_url(_url):
    """No-op until core security module is available."""


def is_confined_to(path, allowed_roots):
    """Check if path is under one of the allowed root directories.

    Compared with commonpath, not a string prefix: a raw startswith accepts
    the sibling `/outputs-evil` for root `/outputs`. commonpath matches whole
    components, keeps `path == root` valid, and realpath strips trailing
    separators. ValueError means the pair is not comparable (mixed
    absolute/relative), which is never confined.
    """
    import os

    path = os.path.realpath(path)
    for root in allowed_roots:
        root = os.path.realpath(root)
        try:
            if os.path.commonpath([path, root]) == root:
                return True
        except ValueError:
            continue
    return False
