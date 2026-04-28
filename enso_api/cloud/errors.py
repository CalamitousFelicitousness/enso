"""Cloud adapter exception hierarchy.

Each exception maps to a specific HTTP status code from cloud providers.
The executor catches by type to determine retry policy and user-facing message.
"""


class CloudError(Exception):
    """Base for all cloud adapter errors."""

    def __init__(self, message: str, provider: str, status: int | None = None):
        super().__init__(message)
        self.provider = provider
        self.status = status


class AuthError(CloudError):
    """401 - Invalid or missing API key."""

    def __init__(self, message: str, provider: str):
        super().__init__(message, provider, status=401)


class QuotaError(CloudError):
    """402 - Insufficient credits or balance."""

    def __init__(self, message: str, provider: str):
        super().__init__(message, provider, status=402)


class RateLimitError(CloudError):
    """429 - Rate limited. Check retry_after for backoff duration."""

    def __init__(self, message: str, provider: str, retry_after: float | None = None):
        super().__init__(message, provider, status=429)
        self.retry_after = retry_after


class ContentFilterError(CloudError):
    """403 - Content policy violation."""

    def __init__(self, message: str, provider: str):
        super().__init__(message, provider, status=403)


class ModelNotFoundError(CloudError):
    """404 - Model ID not recognized by provider."""

    def __init__(self, message: str, provider: str):
        super().__init__(message, provider, status=404)


class ProviderError(CloudError):
    """500/502/503 - Transient upstream failure. Safe to retry."""

    def __init__(self, message: str, provider: str, status: int = 500):
        super().__init__(message, provider, status=status)
