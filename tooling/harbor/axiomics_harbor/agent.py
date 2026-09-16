"""Axiomics as a Harbor installed agent.

Mirrors Harbor's OpenCode adapter: install the pinned release with the
project's own ``install`` script, write a headless config, run
``axiomics run --format json --auto-approve`` in ``/app``, and convert the
JSON event stream into an ATIF trajectory.

Works with Harbor from PyPI (0.22, descriptor-based ``CLI_FLAGS`` and
``SUPPORTS_*`` flags) and with Harbor ``main`` (``options_model`` and
``AgentCapabilities``); the shims below pick whichever the installed
version provides.
"""

from __future__ import annotations

import copy
import json
import os
import shlex
from pathlib import Path
from typing import Annotated, Any

from harbor.agents.installed.base import (
    BaseInstalledAgent,
    CliFlag,
    NonZeroAgentExitCodeError,
    with_prompt_template,
)
from harbor.agents.model_connection import ModelConnectionSpec
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext
from harbor.models.trajectories import Trajectory
from harbor.utils.trajectory_utils import format_trajectory_json

from axiomics_harbor import trajectory

try:  # Harbor main
    from harbor.agents.capabilities import AgentCapabilities
except ImportError:  # Harbor 0.22
    AgentCapabilities = None

try:  # Harbor main
    from pydantic import Field

    from harbor.agents.options import Cli, InstalledAgentOptions
except ImportError:  # Harbor 0.22
    Cli = None
    InstalledAgentOptions = None

INSTALL_URL = os.environ.get("AXIOMICS_INSTALL_URL", "")
BIN_DIR = "$HOME/.axiomics/bin"
UPLOADED_BINARY = "/installed-agent/axiomics"

# The headless environment contract documented in
# frontend/docs/src/content/axiomics/sessions.mdx ("Headless and container
# runs"). Everything Axiomics writes lands under /logs/agent so Harbor
# collects it with the trial.
HEADLESS_ENV = {
    "AXIOMICS_DISABLE_AUTOUPDATE": "1",
    "AXIOMICS_DISABLE_LSP_DOWNLOAD": "1",
    "AXIOMICS_DISABLE_PROJECT_CONFIG": "1",
    "AXIOMICS_SKIP_ENVIRONMENT_BOOTSTRAP": "1",
}

# Full host access inside the task container (no bubblewrap there) and no
# tools that need a Axiomics account or paid remote compute.
DEFAULT_CONFIG: dict[str, Any] = {
    "sandbox": {"enabled": False},
    "permission": {
        "*": "allow",
        "research_search": "deny",
        "atlas": "deny",
        "atlas_write": "deny",
        "remote_compute": "deny",
        "modal": "deny",
        "provider_compute": "deny",
        "compute_job": "deny",
    },
}

if InstalledAgentOptions is not None:

    class AxiomicsOptions(InstalledAgentOptions):
        variant: Annotated[str | None, Cli("--variant")] = Field(
            default=None, description="Provider-specific reasoning effort (e.g. high, max, minimal)."
        )
        effort: Annotated[str | None, Cli("--effort")] = Field(
            default=None, description="Research effort: normal or ultra."
        )
        agent: Annotated[str | None, Cli("--agent")] = Field(
            default=None, description="Primary agent to run (default: research)."
        )
        axiomics_config: dict[str, Any] | None = Field(
            default=None, description="axiomics.json overlay, deep-merged over the headless defaults."
        )
        binary: str | None = Field(
            default=None, description="Host path to an axiomics Linux binary to upload instead of downloading."
        )


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    for key, value in override.items():
        if key in base and isinstance(base[key], dict) and isinstance(value, dict):
            _deep_merge(base[key], value)
        else:
            base[key] = value
    return base


class AxiomicsAgent(BaseInstalledAgent):
    """Run Axiomics headlessly inside a Harbor task container."""

    MODEL_CONNECTION = ModelConnectionSpec(passthrough=True)
    _OUTPUT_FILENAME = "axiomics.txt"

    if AgentCapabilities is not None:
        capabilities = AgentCapabilities(atif=True, resume=True)
    else:
        SUPPORTS_ATIF = True
        SUPPORTS_RESUME = True

    if InstalledAgentOptions is not None:
        options_model = AxiomicsOptions
    else:
        CLI_FLAGS = [
            CliFlag(kwarg="variant", cli="--variant"),
            CliFlag(kwarg="effort", cli="--effort", type="enum", choices=["normal", "ultra"]),
            CliFlag(kwarg="agent", cli="--agent"),
        ]

    def __init__(
        self,
        *args: Any,
        axiomics_config: dict[str, Any] | None = None,
        binary: str | None = None,
        **kwargs: Any,
    ):
        super().__init__(*args, axiomics_config=axiomics_config, binary=binary, **kwargs)
        self._axiomics_config: dict[str, Any] = axiomics_config or {}
        self._binary = binary
        self._instruction: str | None = None

    @staticmethod
    def name() -> str:
        return "axiomics"

    def get_version_command(self) -> str | None:
        return f"{BIN_DIR}/axiomics --version"

    # Paths inside the container, all collected by Harbor after the run.
    @property
    def _logs(self) -> str:
        return str(self.environment_logs_dir)

    @property
    def _data_dir(self) -> str:
        return f"{self._logs}/axiomics/data"

    @property
    def _config_dir(self) -> str:
        return f"{self._logs}/axiomics/config"

    async def install(self, environment: BaseEnvironment) -> None:
        # `coreutils` provides the `stdbuf` run() pipes through; `git` lets the
        # agent version-control the task directory when it chooses to.
        await self.ensure_system_dependencies(environment, ("curl", "bash", "coreutils", "git"))
        if self._binary:
            await environment.upload_file(Path(self._binary), UPLOADED_BINARY)
            await self.exec_as_agent(
                environment,
                command=(
                    f"set -euo pipefail; mkdir -p {BIN_DIR} && "
                    f"install -m 755 {UPLOADED_BINARY} {BIN_DIR}/axiomics && "
                    f"{BIN_DIR}/axiomics --version"
                ),
            )
            return
        if not self._version:
            raise ValueError(
                "Axiomics needs a pinned release: pass --ak version=<x.y.z> "
                "(the first release with `axiomics run --auto-approve`) or --ak binary=<path>."
            )
        # The project's own installer picks the glibc/musl and baseline
        # variant, verifies checksums.txt, and installs to ~/.axiomics/bin.
        await self.exec_as_agent(
            environment,
            command=(
                f"set -euo pipefail; curl -fsSL {INSTALL_URL} | "
                f"bash -s -- --version {shlex.quote(self._version)} --no-modify-path && "
                f"{BIN_DIR}/axiomics --version"
            ),
        )

    def headless_config(self) -> dict[str, Any]:
        config = copy.deepcopy(DEFAULT_CONFIG)
        if self.mcp_servers:
            mcp: dict[str, dict[str, Any]] = {}
            for server in self.mcp_servers:
                if server.transport == "stdio":
                    command = [server.command, *server.args] if server.command else []
                    mcp[server.name] = {"type": "local", "command": command}
                else:
                    mcp[server.name] = {"type": "remote", "url": server.url, "oauth": False}
            config["mcp"] = mcp
        if self.model_name and "/" in self.model_name:
            provider, model_id = self.model_name.split("/", 1)
            entry: dict[str, Any] = {"models": {model_id: {}}}
            base_url = self.model_connection.configured_base_url
            if base_url:
                entry["options"] = {"baseURL": base_url}
            config["provider"] = {provider: entry}
        return _deep_merge(config, copy.deepcopy(self._axiomics_config))

    def setup_command(self) -> str:
        parts = [
            f"mkdir -p {shlex.quote(self._config_dir)} {shlex.quote(self._data_dir)}",
            f"echo {shlex.quote(json.dumps(self.headless_config(), indent=2))} > {shlex.quote(self._config_dir + '/axiomics.json')}",
        ]
        if self.skills_dir:
            skills = shlex.quote(self._data_dir + "/user-skills")
            parts.append(f"mkdir -p {skills} && cp -r {shlex.quote(self.skills_dir)}/* {skills}/ 2>/dev/null || true")
        return " && ".join(parts)

    def run_env(self) -> dict[str, str]:
        env = dict(self.model_connection.env)
        env.update(HEADLESS_ENV)
        env["AXIOMICS_DATA_DIR"] = self._data_dir
        env["AXIOMICS_CONFIG_DIR"] = self._config_dir
        return env

    @with_prompt_template
    async def run(self, instruction: str, environment: BaseEnvironment, context: AgentContext) -> None:
        self._instruction = instruction
        if not self.model_name or "/" not in self.model_name:
            raise ValueError("Model name must be in the format provider/model")

        env = self.run_env()
        await self.exec_as_agent(environment, command=self.setup_command(), env=env)

        flags = self.build_cli_flags()
        resume = "--continue " if self._resume else ""
        await self.exec_as_agent(
            environment,
            command=(
                f'export PATH="{BIN_DIR}:$PATH"; '
                f"axiomics run --format json --auto-approve --model {shlex.quote(self.model_name)} "
                f"{resume}{flags + ' ' if flags else ''}-- {shlex.quote(instruction)} "
                f"2>&1 </dev/null | stdbuf -oL tee {self._logs}/{self._OUTPUT_FILENAME}"
            ),
            env=env,
            cwd="/app",
        )

        # Raise here, not in populate_context_post_run, so Harbor's run-phase
        # error classification and --max-retries apply.
        events = self._events()
        messages = trajectory.errors(events)
        code = trajectory.exit_code(events)
        if messages or (code is not None and code != 0):
            detail = "; ".join(messages[:3]) if messages else f"exit code {code}"
            raise NonZeroAgentExitCodeError(f"Axiomics run failed: {detail}")

    def _events(self) -> list[dict[str, Any]]:
        output = self.logs_dir / self._OUTPUT_FILENAME
        if not output.exists():
            return []
        return trajectory.parse(output.read_text())

    def populate_context_post_run(self, context: AgentContext) -> None:
        events = self._events()
        if not events:
            return
        try:
            data = trajectory.convert(
                events,
                agent_name=self.name(),
                agent_version=self.version() or "unknown",
                model_name=self.model_name,
                instruction=self._instruction,
            )
            result = Trajectory.model_validate(data) if data else None
        except Exception:
            self.logger.exception("Failed to convert Axiomics events to a trajectory")
            return
        if result is None:
            return

        path = self.logs_dir / "trajectory.json"
        try:
            path.write_text(format_trajectory_json(result.to_json_dict()))
        except OSError as exc:
            self.logger.debug(f"Failed to write trajectory file {path}: {exc}")

        metrics = result.final_metrics
        if metrics:
            context.cost_usd = metrics.total_cost_usd
            context.n_input_tokens = metrics.total_prompt_tokens or 0
            context.n_output_tokens = metrics.total_completion_tokens or 0
            context.n_cache_tokens = metrics.total_cached_tokens or 0
