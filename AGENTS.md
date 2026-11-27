# AGENTS

opencode-tools is a set of tools for coding agents, implemented once and
delivered to several harnesses (OpenCode, Claude Code, Codex, Grok Build,
Antigravity, Hermes Agent) from this repository. Releases are GitHub Releases
tagged `v<version>`; consumers pin a tag or the same npm version.

## Layout

- `src/project.ts` — the package's identity: name, tool ID prefix, setting
  prefix and toolsets. The Hermes plugin's counterpart is `project.py` in its
  package.
- `src/core/` — the tool contract and the tools. Each tool is a spec with a
  Zod v4 argument schema, an output schema, a toolset and a write class;
  `execute` gets a `ToolContext`.
- `src/<entry>/` — one thin entry point per delivery, which turns the specs
  into that harness's tools: `src/opencode/` (native plugin), `src/mcp/` (the
  stdio MCP server the other plugins bundle), and `src/cli/`, the command line
  the Hermes plugin (Python, in `src/hermes/`) calls.
- `docs/conventions.md` — the rules every tool follows, and under "The
  OpenCode tools" this package's own.
- Tests sit beside the code they test (`*.test.ts`, `bun test`).

## Rules

- **Every tool follows [`docs/conventions.md`](docs/conventions.md).** A
  change to a convention changes that file first, with its reason.
- **`src/core/` knows no harness and no project.** No harness, product or
  machine names, paths or session conventions in code, descriptions or
  messages; the project's names reach it only through the entry points. Of
  its caller it knows one opaque text, which an entry point supplies and it
  only compares. It uses `node:*` modules and plain dependencies, never a
  runtime's own globals, so it runs on Node and Bun.
- **The package names no setup.** No consumer, profile, model, provider
  account, path or tool of another package in code, defaults, messages,
  tests or skills; they reach it as settings. The two default roles are
  OpenCode's own agents.
- **No record of a run.** A run's state is read from the service each time. A
  state file, a watcher or a stored process id would be a second record that
  disagrees with the service.
- **A session belongs to its caller.** Every tool that lists, reads or acts on
  a session checks its binding first; another caller's session, or a person's
  own, answers as one that does not exist.
- **A run's ruleset holds denies, asks and narrow allows.** A broad allow
  reopens what a subagent denies itself. A request is answered `once` or
  `reject`, never for the session, and what no caller may approve is a deny,
  not an ask.
- **A service the tools start gets a minimal environment.** It keeps that
  environment for every session it later serves, so the allowlist never
  grows to a harness's own variables.
- **Tool IDs are a public interface.** Permission rules and skills key on them
  (`<prefix>_<domain>_<verb>`); renaming one is a breaking change.
- **A tool's write class is its contract with the harness.** The class sets
  the annotations every entry point publishes, so it must be the strictest
  class the tool's arguments can reach. `read_only` registers no write tool;
  annotations are hints, never the boundary.
- **Every program a tool runs goes through one runner**, which fixes a
  non-interactive environment and maps failures to error codes.
- **Every commit stays small.** The pre-commit hook rejects a commit over 500
  reviewable changed lines; split the change instead of raising the limit.

## Commands

- `pnpm test`, `pnpm run typecheck`, `pnpm run format`, `pnpm run format:check`
- Single file: `bun test <path>`
- `pnpm run build && pnpm run smoke`, `pnpm run manifests:check`
- Hermes plugin (Python): `python -m unittest discover -s src/hermes/tests`
