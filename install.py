import os
import shutil
import subprocess
import sys

if "--enso" not in sys.argv:
    sys.exit(0)

ext_root = os.path.dirname(os.path.abspath(__file__))
dist_dir = os.path.join(ext_root, "dist")
node_modules = os.path.join(ext_root, "node_modules")

npm = shutil.which("npm")
if npm is None:
    print("Enso: npm not found, skipping frontend build")
    sys.exit(0)

needs_install = not os.path.isdir(node_modules)
needs_build = not os.path.isdir(dist_dir)

if not needs_install and not needs_build:
    sys.exit(0)

if needs_install:
    print("Enso: installing npm dependencies...")
    subprocess.run([npm, "install"], cwd=ext_root, check=True, capture_output=True)

if needs_build:
    print("Enso: building frontend...")
    subprocess.run([npm, "run", "build"], cwd=ext_root, check=True, capture_output=True)
