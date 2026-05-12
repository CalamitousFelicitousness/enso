"""Shared HTTP transport for cloud adapters.

Handles connection pooling, retry with exponential backoff, TTL caching,
and rate limit tracking. Injected into adapters via composition.
"""

import asyncio
import contextlib
import os
import time

import httpx
from modules.logger import log

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

# SD_CLOUD_DEBUG=1 enables verbose per-request logging.
# Kept module-local (duplicated in openai_compat.py) to avoid cross-module import cycles.
debug = log.debug if os.environ.get("SD_CLOUD_DEBUG") else lambda *args, **kwargs: None


class HttpTransport:
    def __init__(self, config: ProviderConfig, preset: dict, config_store: ConfigStore):
        self.config = config
        self.preset = preset
        self._config_store = config_store
        self.client = httpx.AsyncClient(
            base_url=self._normalize_base_url(config.base_url),
            headers=self._build_headers(),
            timeout=httpx.Timeout(connect=10, read=120, write=30, pool=10),
        )
        self._cache: dict[str, tuple[float, object]] = {}
        self._rate_limit_remaining: int | None = None
        self._rate_limit_reset: float | None = None

    def _normalize_base_url(self, base_url: str) -> str:
        # Every preset path in this module begins with /v1/ (e.g. /v1/chat/completions,
        # /v1/images/generations). httpx concatenates base_url + path rather than
        # urljoin'ing, so a base_url ending in /v1 produces /v1/v1/... requests.
        # The OpenAI Python SDK convention is base_url WITH /v1, which users naturally
        # carry over when configuring a custom provider. Strip it here so both
        # conventions work.
        normalized = base_url.rstrip("/")
        if normalized.endswith("/v1"):
            stripped = normalized[:-3]
            log.info(f"Cloud: base_url normalized provider={self.config.id} from={base_url!r} to={stripped!r}")
            return stripped
        return normalized

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
        t0 = time.time()
        response = await self.client.post(path, json=json, extensions={"timeout": {"read": 300}})
        self._update_rate_limits(response.headers)
        if response.status_code >= 400:
            log.warning(f"Cloud: stream request failed provider={self.config.id} POST {path} status={response.status_code} time={time.time() - t0:.2f}s")
            self.raise_for_status(response)
        debug(f"Cloud: stream opened provider={self.config.id} POST {path} time={time.time() - t0:.2f}s")
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
        t0 = time.time()
        provider_id = self.config.id

        for attempt in range(max_attempts):
            try:
                response = await self.client.request(method, path, **kw)
                self._update_rate_limits(response.headers)
                elapsed = time.time() - t0

                if response.status_code == 429:
                    retry_after = self._parse_retry_after(response.headers)
                    if attempt < 1 and retry_after and retry_after < 60:
                        log.warning(f"Cloud: rate-limited provider={provider_id} {method} {path} retry_after={retry_after:.1f}s attempt={attempt + 1}")
                        await asyncio.sleep(retry_after)
                        continue
                    log.warning(f"Cloud: rate-limited provider={provider_id} {method} {path} retry_after={retry_after} (giving up)")
                    raise RateLimitError(
                        self._extract_error_message(response),
                        provider=provider_id,
                        retry_after=retry_after,
                    )

                if response.status_code in (500, 502, 503) and attempt < max_attempts - 1:
                    delay = backoff * (2**attempt)
                    log.warning(f"Cloud: server error provider={provider_id} {method} {path} status={response.status_code} retry_in={delay:.1f}s attempt={attempt + 1}/{max_attempts}")
                    await asyncio.sleep(delay)
                    continue

                if response.status_code >= 400:
                    log.warning(f"Cloud: request failed provider={provider_id} {method} {path} status={response.status_code} time={elapsed:.2f}s msg={self._extract_error_message(response)!r}")
                    self.raise_for_status(response)

                debug(f"Cloud: request ok provider={provider_id} {method} {path} status={response.status_code} time={elapsed:.2f}s rl_remaining={self._rate_limit_remaining}")
                return response.json()

            except httpx.TimeoutException as e:
                if attempt < max_attempts - 1:
                    delay = backoff * (2**attempt)
                    log.warning(f"Cloud: timeout provider={provider_id} {method} {path} retry_in={delay:.1f}s attempt={attempt + 1}/{max_attempts}")
                    await asyncio.sleep(delay)
                    continue
                log.error(f"Cloud: timeout provider={provider_id} {method} {path} time={time.time() - t0:.2f}s (giving up)")
                raise ProviderError("Request timed out", provider=provider_id) from e

            except httpx.ConnectError as e:
                if attempt < max_attempts - 1:
                    delay = backoff * (2**attempt)
                    log.warning(f"Cloud: connect error provider={provider_id} {method} {path} retry_in={delay:.1f}s attempt={attempt + 1}/{max_attempts}: {e}")
                    await asyncio.sleep(delay)
                    continue
                log.error(f"Cloud: connect failed provider={provider_id} {method} {path}: {e}")
                raise ProviderError("Connection failed", provider=provider_id) from e

            except CloudError:
                raise

            except Exception as e:
                if attempt < max_attempts - 1:
                    delay = backoff * (2**attempt)
                    log.warning(f"Cloud: unexpected error provider={provider_id} {method} {path} retry_in={delay:.1f}s attempt={attempt + 1}/{max_attempts}: {e}")
                    await asyncio.sleep(delay)
                    continue
                log.error(f"Cloud: unexpected error provider={provider_id} {method} {path}: {e}")
                raise ProviderError(str(e), provider=provider_id) from e

        raise ProviderError("Max retries exceeded", provider=provider_id)

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
            with contextlib.suppress(ValueError):
                self._rate_limit_remaining = int(remaining)
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
