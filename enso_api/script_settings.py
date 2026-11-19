"""Script settings of a generate job, placed on sdnext's control runner, the one control_run runs.

A setting sent as None keeps the script's default. Enso applies the always-on scripts in
ALWAYS_ON and refuses the others; rules name settings by label, and a rule whose label the
server's script no longer has keeps that script out.
"""

import inspect
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from enso_api import sdnext_features
from enso_api.rejections import RequestRejected


class ScriptsRejected(RequestRejected):
    code = 422


def always() -> bool:
    return True


def dlss_keeps_seeds() -> bool:
    return sdnext_features.dlss_second_pass()


@dataclass(frozen=True)
class AlwaysOn:
    """How Enso applies one always-on script."""

    held: tuple[str, ...] = ()  # settings kept at the script's default
    choices: dict[str, tuple[str, ...]] = field(default_factory=dict)  # the only choices a setting takes
    own_step: bool = False  # run by Enso after it saves the outputs, not through the script
    usable: Callable[[], bool] = always  # whether this sdnext runs it as Enso needs


ALWAYS_ON: dict[str, AlwaysOn] = {
    # sdnext's HDR script writes only when sdnext saves; Enso saves its outputs itself (hdr.py)
    "hdr": AlwaysOn(own_step=True),
    # Save copy writes a file outside the job's outputs
    "nudenet": AlwaysOn(held=("Save copy",)),
    # FrameGen and the video options need a video
    "nvidia dlss": AlwaysOn(
        held=("FG profile", "FG mode", "FG factor", "FG scene threshold", "Video codec", "Video format", "Pixel format", "FFmpeg options"),
        choices={"DLSS Operations": ("NeuralRender", "SuperRes")},
        usable=dlss_keeps_seeds,
    ),
    # sdnext's own prompt box and input picture
    "prompt enhance": AlwaysOn(held=("Prompt", "")),
    "story mode": AlwaysOn(),
}


@dataclass(frozen=True)
class Script:
    """One script on the runner: its settings' span in the runner's list and their labels."""

    start: int
    end: int
    labels: tuple[str, ...]
    number: int = 0  # 1-based position among the selectable scripts; 0 for an always-on script


@dataclass(frozen=True)
class Runner:
    defaults: tuple[Any, ...]
    selectable: dict[str, Script]
    always_on: dict[str, Script]


def positions(labels: tuple[str, ...], wanted: tuple[str, ...]) -> set[int] | None:
    """Where each wanted label sits; None when one is missing."""
    found = {label: [i for i, own in enumerate(labels) if own == label] for label in wanted}
    if any(not at for at in found.values()):
        return None
    return {i for at in found.values() for i in at}


def missing(rule: AlwaysOn, labels: tuple[str, ...]) -> str | None:
    """The first label a rule names that the script does not have."""
    for label in (*rule.held, *rule.choices):
        if positions(labels, (label,)) is None:
            return label
    return None


def place(runner: Runner, name: str, args: list[Any], always_on: dict[str, Any]) -> tuple[list[Any], dict[str, list[Any]]]:
    """The runner's settings list for a job, and the settings of each always-on script Enso runs itself."""
    placed = list(runner.defaults)
    if name:
        script = runner.selectable.get(name.lower())
        if script is None:
            raise ScriptsRejected(f'No script "{name}" on this server')
        placed[0] = script.number
        put(placed, script, name, args)
    own: dict[str, list[Any]] = {}
    for key, body in always_on.items():
        rule = ALWAYS_ON.get(key)
        script = runner.always_on.get(key)
        if rule is None:
            raise ScriptsRejected(f'The "{key}" script does not run from Enso')
        if script is None:
            raise ScriptsRejected(f'No always-on script "{key}" on this server')
        if not rule.usable():
            raise ScriptsRejected(f'Update SD.Next to run the "{key}" script from Enso')
        gone = missing(rule, script.labels)
        if gone is not None:
            raise ScriptsRejected(f'The "{key}" script on this server has no "{gone}" setting')
        values = list(body.get("args") or []) if isinstance(body, dict) else []
        for label, allowed in rule.choices.items():
            for i in positions(script.labels, (label,)) or ():
                if i < len(values) and values[i] is not None:
                    refused = [v for v in (values[i] if isinstance(values[i], list) else [values[i]]) if v not in allowed]
                    if refused:
                        raise ScriptsRejected(f'{key}: "{label}" takes {" or ".join(allowed)}, not {", ".join(map(str, refused))}')
        if rule.own_step:
            own[key] = put(list(runner.defaults), script, key, values)[script.start : script.end]
            continue
        put(placed, script, key, values, positions(script.labels, rule.held) or set())
    return placed, own


def put(placed: list[Any], script: Script, name: str, values: list[Any], held: set[int] | frozenset[int] = frozenset()) -> list[Any]:
    """Write a script's sent settings into the runner's list; None and held settings keep the default."""
    if len(values) > script.end - script.start:
        raise ScriptsRejected(f'The "{name}" script takes {script.end - script.start} settings; {len(values)} were sent')
    for i, value in enumerate(values):
        if value is not None and i not in held:
            placed[script.start + i] = value
    return placed


def listed_args(name: str, args: list[dict]) -> list[dict] | None:
    """An always-on script's settings as the Scripts tab offers them; None when Enso does not run it."""
    rule = ALWAYS_ON.get(name)
    labels = tuple(arg.get("label") or "" for arg in args)
    if rule is None or missing(rule, labels) is not None or not rule.usable():
        return None
    held = positions(labels, rule.held) or set()
    listed = []
    for i, arg in enumerate(args):
        allowed = rule.choices.get(labels[i])
        if allowed is not None:
            value = arg.get("value")
            arg = {**arg, "choices": [c for c in arg.get("choices") or [] if c in allowed], "value": [v for v in value if v in allowed] if isinstance(value, list) else value}
        listed.append({**arg, "fixed": i in held})
    return listed


def call(fn, kwargs: dict[str, Any], script_args: list[Any]):
    """Call `fn` with keywords and its var-positional script settings, which keywords cannot reach."""
    positional = []
    rest = dict(kwargs)
    for param in inspect.signature(fn).parameters.values():
        if param.kind is param.VAR_POSITIONAL:
            break
        if param.name not in rest and param.default is param.empty:
            raise TypeError(f"{fn.__name__}() needs {param.name}")
        positional.append(rest.pop(param.name, param.default))
    return fn(*positional, *script_args, **rest)


def control_runner() -> Runner:
    """The control runner's scripts and default settings, as control_run would start from."""
    from modules import scripts_manager
    from modules.api import script as api_script

    runner = scripts_manager.scripts_control

    def entry(script, number: int = 0) -> Script:
        info = getattr(script, "api_info", None)
        labels = tuple(arg.label or "" for arg in info.args) if info is not None else ()
        return Script(script.args_from, script.args_to, labels, number)

    return Runner(
        defaults=tuple(api_script.init_default_script_args(runner)),
        selectable={script.title().lower(): entry(script, i + 1) for i, script in enumerate(runner.selectable_scripts)},
        always_on={script.title().lower(): entry(script) for script in runner.alwayson_scripts},
    )
