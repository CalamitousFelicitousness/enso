import os
import shutil
import subprocess


def run():
    ext_root = os.path.dirname(os.path.abspath(__file__))
    dist_dir = os.path.join(ext_root, "dist")
    node_modules = os.path.join(ext_root, "node_modules")
    pkg_json = os.path.join(ext_root, "package.json")
    index_html = os.path.join(dist_dir, "index.html")

    # The frontend ships prebuilt in the repo, so a normal install needs no Node
    # toolchain. Use the committed dist/ as-is and only build when it is missing,
    # or when a contributor sets ENSO_REBUILD to rebuild after changing source.
    have_dist = os.path.isfile(index_html)
    if have_dist and not os.environ.get("ENSO_REBUILD"):
        return

    pnpm = shutil.which("pnpm")
    if pnpm is None:
        if have_dist:
            return  # rebuild requested but no toolchain; keep the prebuilt dist
        print(
            "Enso: dist/ is missing and pnpm was not found, cannot build the frontend.\n"
            "      Install Node.js and pnpm (e.g. run `corepack enable pnpm`) and restart,\n"
            "      or use a checkout that includes the prebuilt dist/ directory."
        )
        return

    # pnpm rewrites node_modules/.modules.yaml on every install, so its mtime marks
    # the last install; reinstall if it is missing or package.json is newer.
    install_marker = os.path.join(node_modules, ".modules.yaml")
    needs_install = not os.path.isdir(node_modules) or not os.path.isfile(install_marker) or os.path.getmtime(pkg_json) > os.path.getmtime(install_marker)
    if needs_install:
        print("Enso: installing pnpm dependencies...")
        subprocess.run([pnpm, "install"], cwd=ext_root, check=True)

    print("Enso: building frontend...")
    subprocess.run([pnpm, "run", "build"], cwd=ext_root, check=True)


run()
