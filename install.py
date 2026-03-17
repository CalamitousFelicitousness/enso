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


def run():
    ext_root = os.path.dirname(os.path.abspath(__file__))
    dist_dir = os.path.join(ext_root, "dist")
    node_modules = os.path.join(ext_root, "node_modules")
    stamp = os.path.join(dist_dir, ".build-stamp")

    npm = shutil.which("npm")
    if npm is None:
        print("Enso: npm not found, skipping frontend build")
        return

    # npm install if node_modules missing or package.json changed
    pkg_json = os.path.join(ext_root, "package.json")
    pkg_lock = os.path.join(node_modules, ".package-lock.json")
    needs_install = not os.path.isdir(node_modules) or not os.path.isfile(pkg_lock) or os.path.getmtime(pkg_json) > os.path.getmtime(pkg_lock)

    stamp_time = os.path.getmtime(stamp) if os.path.isfile(stamp) else 0
    needs_build = not os.path.isdir(dist_dir) or newest_source_mtime(ext_root) > stamp_time

    if not needs_install and not needs_build:
        return

    if needs_install:
        print("Enso: installing npm dependencies...")
        subprocess.run([npm, "install"], cwd=ext_root, check=True, capture_output=True)
        needs_build = True  # deps changed, rebuild

    if needs_build:
        print("Enso: building frontend...")
        subprocess.run([npm, "run", "build"], cwd=ext_root, check=True, capture_output=True)
        with open(stamp, "w") as f:
            pass


run()
