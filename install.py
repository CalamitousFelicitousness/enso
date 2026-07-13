import os
import shutil
import subprocess


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


def run():
    ext_root = os.path.dirname(os.path.abspath(__file__))
    dist_dir = os.path.join(ext_root, "dist")
    node_modules = os.path.join(ext_root, "node_modules")
    stamp = os.path.join(dist_dir, ".build-stamp")

    pnpm = shutil.which("pnpm")
    if pnpm is None:
        state = "serving the previous build" if os.path.isdir(dist_dir) else "no build available"
        print(f"Enso: pnpm not found - frontend build skipped, {state}")
        print("Enso: install pnpm (`npm install -g pnpm` or `corepack enable`) and restart")
        return

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

    stamp_time = os.path.getmtime(stamp) if os.path.isfile(stamp) else 0
    needs_build = not os.path.isdir(dist_dir) or newest_source_mtime(ext_root) > stamp_time

    if not needs_install and not needs_build:
        return

    if needs_install:
        print("Enso: installing dependencies...")
        subprocess.run([pnpm, "install", "--frozen-lockfile"], cwd=ext_root, check=True)
        with open(install_stamp, "w", encoding="utf-8"):
            pass
        needs_build = True  # deps changed, rebuild

    if needs_build:
        print("Enso: building frontend...")
        subprocess.run([pnpm, "run", "build"], cwd=ext_root, check=True)
        with open(stamp, "w", encoding="utf-8"):
            pass


run()
