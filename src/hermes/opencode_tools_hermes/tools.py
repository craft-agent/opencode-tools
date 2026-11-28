"""Registering the tools the command line lists, and running one through it."""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from typing import Any

from .approval import (
    GUARD_FAILED_TEXT,
    PIN_ARGUMENT,
    Guard,
    error_text,
    parse_pin,
    run_arguments,
)
from .caller import caller_flags
from .context import PluginContext
from .listing import READ_CLASS, ToolInfo
from . import project
from .runtime import CliError, Runtime, agent_cwd

#: What the plugin allows a call beyond its own limit, in seconds, so the tool's answer arrives first.
CALL_MARGIN_SECONDS = 30

#: The toolset name of a tool in ``hermes tools``: the package's toolset after this prefix.
TOOLSET_PREFIX = f"{project.PLUGIN_NAME}-"

#: The emoji each toolset is shown with.
TOOLSET_EMOJI = project.TOOLSET_EMOJI


def error_result(message: str) -> str:
    """The JSON a failed call returns to the model."""
    return json.dumps({"error": message})


def _read_document(stdout: str) -> dict[str, Any] | None:
    """The JSON object a command line wrote, or ``None`` when it wrote something else."""
    try:
        document = json.loads(stdout)
    except json.JSONDecodeError:
        return None
    return document if isinstance(document, dict) else None


def _failure(code: int, stdout: str, stderr: str) -> str:
    """The error result of a command line that did not succeed: its ``<code>: <message>`` and details line, or its stderr."""
    error = (_read_document(stdout) or {}).get("error")
    message = error_text(error)
    if message is not None:
        return error_result(message)
    detail = stderr.strip() or f"exit status {code}"
    return error_result(f"{project.CLI_NAME} failed: {detail}")


def call_timeout(wait_seconds: float) -> float:
    """How long the plugin lets one call run: the tool's own limit ``wait_seconds`` and the margin after it."""
    return wait_seconds + CALL_MARGIN_SECONDS


def make_handler(
    runtime: Runtime,
    tool_id: str,
    flags: list[str],
    guard: Guard | None = None,
    *,
    timeout: float = call_timeout(project.DEFAULT_WAIT_SECONDS),
) -> Callable[..., str]:
    """The handler Hermes calls for one tool: it takes the arguments as one dict and never raises.

    The command line is ended after ``timeout`` seconds.

    The pin the pin hook set (``PIN_ARGUMENT``) is taken out of the arguments and, when it is a
    pin, passed to ``run`` as ``--pin``; anything else runs as if there were none.
    """

    def handler(args: dict[str, Any], **kwargs: Any) -> str:
        try:
            if guard is not None and (refused := guard()) is not None:
                return error_result(refused or GUARD_FAILED_TEXT)
            pin = parse_pin(args.get(PIN_ARGUMENT))
            result = runtime.run(
                ["run", tool_id, "--cwd", agent_cwd(), *flags, *caller_flags(kwargs), *([f"--pin={pin}"] if pin else [])],
                stdin=json.dumps(run_arguments(args)),
                timeout=timeout,
            )
        except CliError as error:
            return error_result(str(error))
        except Exception as error:  # a tool call must reach the model as a result, whatever went wrong
            return error_result(f"{tool_id} could not run: {error}")
        document = _read_document(result.stdout)
        if result.code == 0 and document is not None and "result" in document:
            return result.stdout.strip()
        return _failure(result.code, result.stdout, result.stderr)

    return handler


def register_tools(
    ctx: PluginContext,
    runtime: Runtime,
    tools: list[ToolInfo],
    flags: list[str],
    emoji: Mapping[str, str] | None = None,
    guard: Guard | None = None,
    *,
    timeout: float = call_timeout(project.DEFAULT_WAIT_SECONDS),
) -> None:
    """Register each listed tool under its own ID, grouped in one Hermes toolset per package toolset."""
    toolset_emoji = TOOLSET_EMOJI if emoji is None else emoji
    for tool in tools:
        ctx.register_tool(
            name=tool.id,
            toolset=TOOLSET_PREFIX + tool.toolset.replace("_", "-"),
            schema={"name": tool.id, "description": tool.description, "parameters": tool.input_schema},
            handler=make_handler(
                runtime, tool.id, flags, guard if tool.write_class != READ_CLASS else None, timeout=timeout
            ),
            emoji=toolset_emoji.get(tool.toolset, ""),
            description=tool.title,
        )
