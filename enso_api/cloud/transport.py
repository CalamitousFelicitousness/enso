"""Shared HTTP transport for cloud adapters.

Handles connection pooling, retry with exponential backoff, TTL caching,
and rate limit tracking. Injected into adapters via composition.
"""

import asyncio
import time

import httpx

from enso_api.cloud.config import ConfigStore, ProviderConfig
from enso_api.cloud.errors import (
    AuthError,
    CloudError,
    ContentFilterError,
    ModelNotFoundError,
    ProviderError,
    QuotaError,
    RateLimitError,
)


class HttpTransport:
    def __init__(self, config: ProviderConfig, preset: dict, config_store: ConfigStore):
        self.config = config
        self.preset = preset
        self._config_store = config_store
        self.client = httpx.AsyncClient(
            base_url=config.base_url,
            headers=self._build_headers(),
            timeout=httpx.Timeout(connect=10, read=120, write=30, pool=10),
        )
        self._cache: dict[str, tuple[float, object]] = {}
        self._rate_limit_remaining: int | None = None
        self._rate_limit_reset: float | None = None

    def _build_headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        auth_type = self.preset.get("auth_header")
        key = self._config_store.resolve_key(self.config)
        if auth_type and key:
            headers["Authorization"] = f"{auth_type} {key}"
        for k, v in self.preset.get("extra_headers", {}).items():
            if v:
                headers[k] = v
        return headers

    async def get(self, path: str, params: dict | None = None) -> dict:
        return await self._request("GET", path, params=params)

    async def post(self, path: str, json: dict | None = None, **kw) -> dict:
        return await self._request("POST", path, json=json, **kw)

    async def post_stream(self, path: str, json: dict) -> httpx.Response:
        response = await self.client.post(path, json=json, extensions={"timeout": {"read": 300}})
        self._update_rate_limits(response.headers)
        if response.status_code >= 400:
            self.raise_for_status(response)
        return response

    async def get_cached(self, path: str, ttl: int = 300, params: dict | None = None) -> object:
        cache_key = f"{path}?{params}" if params else path
        now = time.time()
        if cache_key in self._cache:
            expires, data = self._cache[cache_key]
            if now < expires:
                return data
        result = await self.get(path, params=params)
        self._cache[cache_key] = (now + ttl, result)
        return result

    def invalidate_cache(self, path: str | None = None) -> None:
        if path is None:
            self._cache.clear()
        else:
            self._cache = {k: v for k, v in self._cache.items() if not k.startswith(path)}

    async def _request(self, method: str, path: str, **kw) -> dict:
        max_attempts = 3
        backoff = 1.0

        for attempt in range(max_attempts):
            try:
                response = await self.client.request(method, path, **kw)
                self._update_rate_limits(response.headers)

                if response.status_code == 429:
                    retry_after = self._parse_retry_after(response.headers)
                    if attempt < 1 and retry_after and retry_after < 60:
                        await asyncio.sleep(retry_after)
                        continue
                    raise RateLimitError(
                        self._extract_error_message(response),
                        provider=self.config.id,
                        retry_after=retry_after,
                    )

                if response.status_code in (500, 502, 503) and attempt < max_attempts - 1:
                    await asyncio.sleep(backoff * (2 ** attempt))
                    continue

                if response.status_code >= 400:
                    self.raise_for_status(response)

                return response.json()

            except httpx.TimeoutException as e:
                if attempt < max_attempts - 1:
                    await asyncio.sleep(backoff * (2 ** attempt))
                    continue
                raise ProviderError("Request timed out", provider=self.config.id) from e

            except httpx.ConnectError as e:
                if attempt < max_attempts - 1:
                    await asyncio.sleep(backoff * (2 ** attempt))
                    continue
                raise ProviderError("Connection failed", provider=self.config.id) from e

            except CloudError:
                raise

            except Exception as e:
                if attempt < max_attempts - 1:
                    await asyncio.sleep(backoff * (2 ** attempt))
                    continue
                raise ProviderError(str(e), provider=self.config.id) from e

        raise ProviderError("Max retries exceeded", provider=self.config.id)

    def raise_for_status(self, response: httpx.Response) -> None:
        message = self._extract_error_message(response)
        status = response.status_code
        provider = self.config.id

        if status == 401:
            raise AuthError(message, provider)
        if status == 402:
            raise QuotaError(message, provider)
        if status == 403:
            raise ContentFilterError(message, provider)
        if status == 404:
            raise ModelNotFoundError(message, provider)
        if status == 429:
            raise RateLimitError(message, provider, self._parse_retry_after(response.headers))
        raise ProviderError(message, provider, status=status)

    def _extract_error_message(self, response: httpx.Response) -> str:
        try:
            data = response.json()
            error = data.get("error", {})
            if isinstance(error, dict):
                return error.get("message", "") or str(error)
            return str(error)
        except Exception:
            return response.text[:200] if response.text else f"HTTP {response.status_code}"

    def _update_rate_limits(self, headers: httpx.Headers) -> None:
        remaining = headers.get("x-ratelimit-remaining") or headers.get("x-ratelimit-remaining-requests")
        if remaining is not None:
            try:
                self._rate_limit_remaining = int(remaining)
            except ValueError:
                pass
        reset = headers.get("x-ratelimit-reset") or headers.get("x-ratelimit-reset-requests")
        if reset is not None:
            try:
                val = float(reset)
                self._rate_limit_reset = val if val > 1_000_000_000 else time.time() + val
            except ValueError:
                pass

    def _parse_retry_after(self, headers: httpx.Headers) -> float | None:
        raw = headers.get("retry-after") or headers.get("x-ratelimit-reset")
        if raw is None:
            return None
        try:
            val = float(raw)
            if val > 1_000_000_000:
                return max(0, val / 1000 - time.time())
            return val
        except ValueError:
            return None

    async def close(self) -> None:
        await self.client.aclose()
