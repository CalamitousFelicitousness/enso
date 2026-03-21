#!/usr/bin/env python3
"""Enso API compatibility checker.

Calls every Enso v2 GET endpoint (and safe POST endpoints) against a running
SD.Next instance to surface import errors, missing attributes, and broken
integration points after the sdnext merge.

Usage:
    python test_api_compat.py [--host HOST] [--port PORT]

Defaults to http://127.0.0.1:7855
"""

import argparse
import json
import sys
import time
import urllib.request
import urllib.error

# ── Configuration ──────────────────────────────────────────────────────────

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 7855
TIMEOUT = 30  # seconds per request

# ── Endpoint catalog ───────────────────────────────────────────────────────
# (method, path, body_or_None, description)
# Only safe operations: GETs, POSTs that don't mutate state or trigger generation.

ENDPOINTS: list[tuple[str, str, dict | None, str]] = [
    # --- Server / status ---
    ("GET",  "/sdapi/v2/server-info",       None, "Server info (version, backend, model)"),
    ("GET",  "/sdapi/v2/memory",            None, "RAM + CUDA memory stats"),
    ("GET",  "/sdapi/v2/gpu",               None, "GPU metrics"),
    ("GET",  "/sdapi/v2/system-info",       None, "Full system diagnostics"),
    ("GET",  "/sdapi/v2/log?lines=5",       None, "Recent log lines"),

    # --- Options ---
    ("GET",  "/sdapi/v2/options",           None, "All server options"),
    ("GET",  "/sdapi/v2/options?keys=sd_model_checkpoint", None, "Filtered options"),
    ("GET",  "/sdapi/v2/options-info",      None, "Options metadata"),
    ("GET",  "/sdapi/v2/secrets-status",    None, "Secrets config status"),

    # --- Enumerators ---
    ("GET",  "/sdapi/v2/extra-networks?limit=3", None, "Extra networks (paginated)"),
    ("GET",  "/sdapi/v2/sd-models?limit=3",      None, "SD models list"),
    ("GET",  "/sdapi/v2/samplers",                None, "Samplers list"),
    ("GET",  "/sdapi/v2/sd-vae",                  None, "VAE models"),
    ("GET",  "/sdapi/v2/upscalers",               None, "Upscaler models"),
    ("GET",  "/sdapi/v2/embeddings",              None, "Embeddings"),
    ("GET",  "/sdapi/v2/prompt-styles",           None, "Prompt styles"),
    ("GET",  "/sdapi/v2/detailers",               None, "Detailer (YOLO) models"),
    ("GET",  "/sdapi/v2/scripts",                 None, "Scripts list"),
    ("GET",  "/sdapi/v2/extensions",              None, "Installed extensions"),

    # --- Control ---
    ("GET",  "/sdapi/v2/control-models",    None, "ControlNet models"),
    ("GET",  "/sdapi/v2/control-modes",     None, "Control modes"),
    ("GET",  "/sdapi/v2/ip-adapters",       None, "IP-Adapter models"),
    ("GET",  "/sdapi/v2/preprocessors",     None, "Preprocessors"),

    # --- Models (read-only) ---
    ("GET",  "/sdapi/v2/checkpoint",        None, "Current checkpoint info"),
    ("GET",  "/sdapi/v2/loaded-models",     None, "All loaded models inventory"),
    ("GET",  "/sdapi/v2/model/analyze",     None, "Analyze current model"),
    ("GET",  "/sdapi/v2/model/list-detail", None, "Detailed model list"),
    ("GET",  "/sdapi/v2/model/merge/methods", None, "Merge methods"),
    ("GET",  "/sdapi/v2/model/lora/loaded", None, "Loaded LoRAs"),
    ("GET",  "/sdapi/v2/model/loader/pipelines", None, "Loader pipelines"),

    # --- History ---
    ("GET",  "/sdapi/v2/history?limit=3",   None, "Generation history"),

    # --- Jobs (read-only) ---
    ("GET",  "/sdapi/v2/jobs",              None, "Job list"),
    ("GET",  "/sdapi/v2/jobs/stats",        None, "Job stats"),

    # --- Gallery / browser ---
    ("GET",  "/sdapi/v2/browser/folders",   None, "Gallery folders"),

    # --- Video ---
    ("GET",  "/sdapi/v2/video/engines",     None, "Video engines + models"),
    ("GET",  "/sdapi/v2/framepack/variants", None, "FramePack variants"),

    # --- Caption ---
    ("GET",  "/sdapi/v2/caption/openclip/models", None, "OpenCLIP models"),
    ("GET",  "/sdapi/v2/caption/vlm/models",      None, "VLM models"),
    ("GET",  "/sdapi/v2/caption/tagger/models",    None, "Tagger models"),

    # --- Prompt enhance ---
    ("GET",  "/sdapi/v2/prompt-enhance/models", None, "Prompt enhance models"),

    # --- XYZ Grid ---
    ("GET",  "/sdapi/v2/xyz-grid/axes",     None, "XYZ grid axis options"),

    # --- Misc ---
    ("GET",  "/sdapi/v2/extra-networks/detail?page=lora&name=test", None, "Extra network detail (may 404)"),
    ("GET",  "/sdapi/v2/extra-networks/details?limit=2", None, "Extra network details batch"),

    # --- HuggingFace ---
    ("GET",  "/sdapi/v2/huggingface/settings", None, "HuggingFace settings"),
    ("GET",  "/sdapi/v2/huggingface/me",       None, "HuggingFace profile"),

    # --- WebSocket ticket (safe POST) ---
    ("POST", "/sdapi/v2/ws-ticket",         None, "WS ticket creation"),

    # --- Safe mutation POSTs (state-check only) ---
    ("POST", "/sdapi/v2/checkpoint/unload", None, "Unload checkpoint (tests the fixed code)"),
    ("GET",  "/sdapi/v2/storage",            None, "Storage info"),
]


# ── Runner ─────────────────────────────────────────────────────────────────

class Result:
    def __init__(self, method, path, desc):
        self.method = method
        self.path = path
        self.desc = desc
        self.status = None
        self.error = None
        self.body_preview = None
        self.duration_ms = None
        self.server_error_detail = None

    @property
    def ok(self):
        return self.status is not None and 200 <= self.status < 400

    @property
    def server_error(self):
        return self.status is not None and self.status >= 500


def run_endpoint(base_url, method, path, body, desc) -> Result:
    r = Result(method, path, desc)
    url = f"{base_url}{path}"
    data = json.dumps(body).encode() if body else None
    headers = {"Content-Type": "application/json"} if body else {}
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    start = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            r.status = resp.status
            raw = resp.read()
            r.duration_ms = int((time.monotonic() - start) * 1000)
            try:
                parsed = json.loads(raw)
                preview = json.dumps(parsed, indent=None, default=str)
                r.body_preview = preview[:200] + "..." if len(preview) > 200 else preview
            except Exception:
                r.body_preview = raw[:200].decode(errors="replace")
    except urllib.error.HTTPError as e:
        r.status = e.code
        r.duration_ms = int((time.monotonic() - start) * 1000)
        try:
            err_body = e.read().decode(errors="replace")
            r.server_error_detail = err_body[:500]
        except Exception:
            pass
        r.error = f"HTTP {e.code}"
    except Exception as e:
        r.duration_ms = int((time.monotonic() - start) * 1000)
        r.error = str(e)
    return r


def main():
    parser = argparse.ArgumentParser(description="Enso API compatibility checker")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args()
    base = f"http://{args.host}:{args.port}"

    # Quick connectivity check
    print(f"\n  Checking {base}/sdapi/v2/server-info ...")
    try:
        with urllib.request.urlopen(f"{base}/sdapi/v2/server-info", timeout=5):
            pass
        print("  Connected.\n")
    except Exception as e:
        print(f"  Cannot connect: {e}")
        print("  Is SD.Next running on that port?\n")
        sys.exit(1)

    results = []
    total = len(ENDPOINTS)
    for i, (method, path, body, desc) in enumerate(ENDPOINTS, 1):
        print(f"  [{i:2d}/{total}] {method:4s} {path[:60]:<60s} ", end="", flush=True)
        r = run_endpoint(base, method, path, body, desc)
        if r.ok:
            print(f"  OK  {r.status} ({r.duration_ms}ms)")
        elif r.server_error:
            print(f"  FAIL {r.status} ({r.duration_ms}ms)  << SERVER ERROR >>")
        elif r.status == 422:
            print(f"  WARN {r.status} ({r.duration_ms}ms)  [validation error]")
        elif r.status is not None:
            print(f"  {r.status} ({r.duration_ms}ms)")
        else:
            print(f"  ERR  {r.error}")
        results.append(r)

    # ── Summary ────────────────────────────────────────────────────────────
    passed = [r for r in results if r.ok]
    failed = [r for r in results if r.server_error]
    client_err = [r for r in results if r.status and 400 <= r.status < 500]
    conn_err = [r for r in results if r.status is None]

    print("\n" + "=" * 80)
    print(f"  RESULTS: {len(passed)} passed, {len(failed)} server errors, "
          f"{len(client_err)} client errors, {len(conn_err)} connection errors")
    print("=" * 80)

    if failed:
        print("\n  SERVER ERRORS (500) — likely broken imports or missing attributes:\n")
        for r in failed:
            print(f"    {r.method:4s} {r.path}")
            print(f"         {r.desc}")
            if r.server_error_detail:
                # Try to extract the actual error from the detail
                detail = r.server_error_detail
                try:
                    parsed = json.loads(detail)
                    if "detail" in parsed:
                        detail = parsed["detail"]
                except Exception:
                    pass
                # Show just the last meaningful line for brevity
                lines = [line.strip() for line in str(detail).split("\n") if line.strip()]
                if lines:
                    print(f"         Error: {lines[-1][:120]}")
            print()

    if client_err:
        print("\n  CLIENT ERRORS (4xx) — may be expected for endpoints needing params:\n")
        for r in client_err:
            print(f"    {r.method:4s} {r.path}  →  {r.status}")

    print()


if __name__ == "__main__":
    main()
