import hashlib
import io
import os
import re
import shutil
import subprocess
import urllib.error
import urllib.request
import zipfile

UPSTREAM = "https://github.com/CalamitousFelicitousness/enso"
GITHUB_REMOTE = re.compile(r"github\.com[:/]+([^/]+)/([^/]+?)(?:\.git)?/?$", re.IGNORECASE)


def newest_source_mtime(ext_root):
    newest = 0
    for d in ("src", "public"):
        dirpath = os.path.join(ext_root, d)
        if not os.path.isdir(dirpath):
            continue
        for root, _, files in os.walk(dirpath):
            for f in files:
                t = os.path.getmtime(os.path.join(root, f))
                if t > newest:
                    newest = t
    for f in ("index.html", "vite.config.ts", "tsconfig.json", "tsconfig.app.json", "tsconfig.node.json", "components.json", "package.json"):
        fp = os.path.join(ext_root, f)
        if os.path.isfile(fp):
            t = os.path.getmtime(fp)
            if t > newest:
                newest = t
    return newest


def mtime_or_zero(path):
    return os.path.getmtime(path) if os.path.isfile(path) else 0


def head_sha(ext_root):
    try:
        proc = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ext_root, capture_output=True, text=True, check=True)
        return proc.stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def release_base(ext_root):
    """Release download URL for this checkout's own origin, so a fork serves its own CI builds."""
    override = os.environ.get("ENSO_RELEASE_BASE")
    if override:
        return override
    try:
        proc = subprocess.run(["git", "remote", "get-url", "origin"], cwd=ext_root, capture_output=True, text=True, check=True)
        m = GITHUB_REMOTE.search(proc.stdout.strip())
        if m:
            return f"https://github.com/{m.group(1)}/{m.group(2)}/releases/download"
    except (OSError, subprocess.CalledProcessError):
        pass
    return f"{UPSTREAM}/releases/download"


def read_meta(meta_path):
    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return None


def download_dist(dist_dir, sha, base):
    """Fetch the CI-built dist for the checked-out commit and swap it in."""
    url = f"{base}/build-{sha[:7]}/dist.zip"
    with urllib.request.urlopen(url, timeout=30) as resp:
        blob = resp.read()
    with urllib.request.urlopen(url + ".sha256", timeout=30) as resp:
        expected = resp.read().decode("utf-8").split()[0]
    digest = hashlib.sha256(blob).hexdigest()
    if digest != expected:
        raise ValueError(f"checksum mismatch: expected {expected}, got {digest}")
    staging = dist_dir + ".new"
    if os.path.isdir(staging):
        shutil.rmtree(staging)
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        zf.extractall(staging)
    with open(os.path.join(staging, ".build-meta"), "w", encoding="utf-8") as f:
        f.write(sha + "\n")
    if os.path.isdir(dist_dir):
        shutil.rmtree(dist_dir)
    os.rename(staging, dist_dir)


def local_build(ext_root, dist_dir):
    """Build from source with pnpm. Returns False when pnpm is unavailable."""
    pnpm = shutil.which("pnpm")
    if pnpm is None:
        return False

    node_modules = os.path.join(ext_root, "node_modules")

    # A node_modules without pnpm's state file was built by another package
    # manager; pnpm cannot adopt it, so start from a clean tree.
    modules_state = os.path.join(node_modules, ".modules.yaml")
    if os.path.isdir(node_modules) and not os.path.isfile(modules_state):
        print("Enso: removing non-pnpm node_modules...")
        shutil.rmtree(node_modules)

    # Frozen install is read-only against pnpm-lock.yaml; a plain install could
    # rewrite it, and the resulting dirty tree makes SD.Next's extension
    # updater report "local changes detected". pnpm leaves .modules.yaml
    # untouched on no-op installs, so freshness uses our own stamp file.
    install_stamp = os.path.join(node_modules, ".install-stamp")
    manifest_mtime = max(
        mtime_or_zero(os.path.join(ext_root, "package.json")),
        mtime_or_zero(os.path.join(ext_root, "pnpm-lock.yaml")),
    )
    needs_install = not os.path.isfile(install_stamp) or manifest_mtime > os.path.getmtime(install_stamp)

    stamp = os.path.join(dist_dir, ".build-stamp")
    built_time = max(mtime_or_zero(stamp), mtime_or_zero(os.path.join(dist_dir, ".build-meta")))
    needs_build = not os.path.isdir(dist_dir) or newest_source_mtime(ext_root) > built_time

    if needs_install:
        print("Enso: installing dependencies...")
        subprocess.run([pnpm, "install", "--frozen-lockfile"], cwd=ext_root, check=True)
        with open(install_stamp, "w", encoding="utf-8"):
            pass
        needs_build = True

    if needs_build:
        print("Enso: building frontend...")
        subprocess.run([pnpm, "run", "build"], cwd=ext_root, check=True)
        with open(stamp, "w", encoding="utf-8"):
            pass

    return True


def run():
    ext_root = os.path.dirname(os.path.abspath(__file__))
    dist_dir = os.path.join(ext_root, "dist")
    meta_path = os.path.join(dist_dir, ".build-meta")

    sha = head_sha(ext_root)
    meta = read_meta(meta_path)
    built_time = max(mtime_or_zero(meta_path), mtime_or_zero(os.path.join(dist_dir, ".build-stamp")))
    sources_newer = newest_source_mtime(ext_root) > built_time

    if sha is not None and sha == meta and not sources_newer:
        return

    if sha is None:
        why = "cannot determine the checked-out commit"
    elif sha == meta:
        # matching prebuilt dist is already installed; the edits are local,
        # so a download would only fetch the same asset again
        why = "local source changes detected"
    else:
        try:
            download_dist(dist_dir, sha, release_base(ext_root))
            print(f"Enso: prebuilt frontend {sha[:7]} installed")
            return
        except urllib.error.HTTPError as e:
            if e.code == 404:
                why = f"no prebuilt frontend published for {sha[:7]} yet"
            else:
                why = f"frontend download failed ({e})"
        except (OSError, ValueError) as e:
            why = f"frontend download failed ({e})"

    if local_build(ext_root, dist_dir):
        return

    if os.path.isdir(dist_dir):
        print(f"Enso: {why}; pnpm not found, serving the existing build")
    else:
        print(f"Enso: {why}; pnpm not found and no previous build exists")
        print("Enso: restart once the GitHub build publishes, or install pnpm (`npm install -g pnpm`) to build locally")


run()
