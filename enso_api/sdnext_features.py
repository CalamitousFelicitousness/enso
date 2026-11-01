"""What the running sdnext supports where the answer depends on the commits its checkout carries."""

import subprocess

# ea0d5c79f (dev, 2026-10-05): with a separate init image every ControlNet class receives the
# unit's own picture, and two units run on a union model. A squash or cherry-pick of the same
# change on another branch gets its hash added here.
CONTROL_SEPARATE_INIT_COMMITS = ("ea0d5c79f",)
# db944539b (dev, 2026-10-31): processing_args.get_guidance_params, which also counts what a modular pipeline's guider takes.
GUIDANCE_PARAMS_COMMITS = ("db944539b",)
# 122a4393d (dev, 2026-10-31): State.fail keeps a failed pass's exception message on shared.state.error.
PASS_ERROR_COMMITS = ("122a4393d",)

known: dict[str, bool] = {}


def has_commit(commit: str) -> bool:
    """Whether sdnext's checkout descends from commit; False, logged once, when git cannot tell."""
    if commit in known:
        return known[commit]
    from modules.logger import log
    from modules.paths import script_path

    try:
        done = subprocess.run(["git", "merge-base", "--is-ancestor", commit, "HEAD"], cwd=script_path, capture_output=True, text=True, timeout=10, check=False)
        present = done.returncode == 0
        if done.returncode not in (0, 1):
            log.warning(f"Enso: cannot tell whether sdnext carries {commit}, so what needs it is off: {done.stderr.strip() or done.returncode}")
    except (OSError, subprocess.TimeoutExpired) as e:
        log.warning(f"Enso: cannot tell whether sdnext carries {commit}, so what needs it is off: {e}")
        present = False
    known[commit] = present
    return present


def control_separate_init() -> bool:
    """A separate init image (input_type 2 with inits) leaves each control unit its own picture."""
    return any(has_commit(commit) for commit in CONTROL_SEPARATE_INIT_COMMITS)


def guidance_params() -> bool:
    """sdnext reports which guidance settings reach a pipeline, its guider included."""
    return any(has_commit(commit) for commit in GUIDANCE_PARAMS_COMMITS)


def pass_error() -> bool:
    """sdnext keeps a failed pass's exception message on shared.state.error until the next job begins."""
    return any(has_commit(commit) for commit in PASS_ERROR_COMMITS)
