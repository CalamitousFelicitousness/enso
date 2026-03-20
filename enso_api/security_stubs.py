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
    """Check if path is under one of the allowed root directories."""
    import os
    path = os.path.realpath(path)
    return any(path.startswith(os.path.realpath(r)) for r in allowed_roots)
