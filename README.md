# opencode-tools

OpenCode tools for coding agents: start, follow, steer and answer sessions from another harness.

| Harness        | Delivery                                       | Pinned by                      |
| -------------- | ---------------------------------------------- | ------------------------------ |
| Claude Code    | plugin: MCP server and skills                  | the release tag, as the ref    |
| Codex          | plugin: MCP server and skills                  | the release tag, as the ref    |
| Grok Build     | plugin: MCP server and skills                  | the release tag, as `@ref`     |
| Antigravity    | plugin: MCP server and skills                  | the release tag's tree URL     |
| Hermes Agent   | native plugin (Python, calls the command line) | the release commit, as the SHA |
| other MCP host | MCP server from npm                            | the version in the package     |

The tools need [Node.js](https://nodejs.org/) 24 or later and
[OpenCode](https://opencode.ai/) 2.4.2 or later, the version they are tested
against.
[`docs/conventions.md`](docs/conventions.md) describes how the tools are named
and how they behave.

## Install

Install from a release, never from the default branch: a release is a tag whose
commit carries the built `dist/`, and the default branch does not. In the
commands below, `<version>` is a release's version (`1.2.3`) and `<sha>` is the
commit its tag names:

```sh
gh api repos/craft-agent/opencode-tools/commits/v<version> --jq .sha
```

The package is not installed into OpenCode itself: the tools drive OpenCode
from another harness, and a session they start cannot call them.

### Claude Code

```sh
claude plugin marketplace add craft-agent/opencode-tools#v<version>
claude plugin install opencode-tools@opencode-tools
```

### Codex

```sh
codex plugin marketplace add craft-agent/opencode-tools --ref v<version>
codex plugin add opencode-tools@opencode-tools
```

Codex turns `-` into `_` in server names, so it shows the tools as
`mcp__opencode_tools__opencode_*`. It starts the MCP server in the plugin's
install directory and passes no roots, so the server takes each call's directory
from what Codex sends with the call: its sandbox state, which the server asks
for, else the one workspace it names.

The plugin declares `default_tools_approval_mode = "writes"`: Codex asks before
every tool not marked read-only. A user's
`[plugins."<plugin>".mcp_servers.<server>]` setting can only tighten it. Setting
`auto` there yields `prompt` (reads asked too), since Codex treats `auto` and
`writes` as incomparable.

### Grok Build

```sh
grok plugin install craft-agent/opencode-tools@v<version> --trust
```

Grok starts the MCP server in the session's working directory.

### Antigravity

Install from the tree of the release tag, never from the default branch, which
has no built `dist/`; Antigravity clones the tag into
`~/.gemini/config/plugins/opencode-tools`.

```sh
agy plugin install https://github.com/craft-agent/opencode-tools/tree/v<version>
```

### Hermes Agent

Hermes installs a commit, not a tag, and the plugin installs disabled:

```sh
hermes plugins install craft-agent/opencode-tools --ref <sha>
hermes plugins enable opencode-tools
```

If a Hermes gateway is already running, restart it (`hermes gateway restart`) to
load the plugin.

The plugin runs the Node it found when Hermes started. If a version manager
removes that version while Hermes runs, a call looks for Node again; when it
finds none, restart Hermes from a shell where `node` runs.

When the package's writes depend on another Hermes plugin, such as a guard
that blocks writes no one is there to approve, name it in `require_plugins`.
Hermes keeps loading this plugin when that one fails to import or register,
and treats a manifest's `requires_plugins` as advisory. With the setting,
while a named plugin is not loaded, every write is refused before it is
approved, even under `--yolo`, `approvals.mode: off` or a remembered answer,
naming the plugin that is missing. Reads still run.

```yaml
plugins:
  entries:
    opencode-tools:
      settings:
        require_plugins: [write-guard]
```

### Any other MCP host

Add the server to the host's MCP configuration. Flags go in `args`:

```json
{
  "mcpServers": {
    "opencode-tools": {
      "command": "npx",
      "args": ["-y", "@craftsamo/opencode-tools@<version>", "--read-only"]
    }
  }
}
```

## The OpenCode service

The tools reach the OpenCode service a person already runs, through
OpenCode's own client. When no service is running, a call starts one
(`opencode serve --service`) and leaves it running. A read does too, also
under `read_only`, and its result says so.

A call ends within `wait_seconds` of its start, 50 seconds unless you set it:
the service starting (up to 30 seconds), a directory loading and each request
(10 seconds) all draw on that one limit. A harness that ends a tool call
after a minute therefore never cuts one off. A call that runs out fails and
says what it was waiting for. The Hermes plugin ends a call 30 seconds after
the setting.

A service keeps the environment it was started with for every session it
later serves, a person's own included. So one the tools start is given only
what finds a person's programs and configuration: `PATH`, `HOME`, `USER`,
`LOGNAME`, `SHELL`, the locale (`LANG`, `LANGUAGE`, `LC_ALL`, `LC_CTYPE`,
`LC_MESSAGES`), `TERM`, `TMPDIR`, `TZ`, and `XDG_CONFIG_HOME`,
`XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME` and `XDG_RUNTIME_DIR`.
Nothing else of the harness's environment goes with it.

A provider key that lives only in a shell variable therefore does not reach
a service the tools start. Keep it in OpenCode's own service configuration,
or start the service yourself before the tools need it: a running service
is used as it is, and never restarted or stopped.

Asking about a directory opens it in OpenCode, as starting OpenCode there
would: the service keeps it as a project and loads its configuration, which
takes a moment the first time, and a few seconds in a service that has just
started. The tools wait for that, for up to fifteen seconds.

## Tools and skills

Each toolset comes with a skill that tells an agent how to use its tools. A
skill names its toolset under `metadata` in its frontmatter
(`metadata: { toolset: <name> }`, written as a block). Hermes registers it
only when the settings register at least one of that toolset's tools, so a
profile with the toolset off, or with all its tools removed, does not see it;
a skill without a toolset is always registered. Claude Code, Codex, Grok Build
and Antigravity install the skill folder whole and pass the settings only to
the MCP server, so they list every skill whatever the settings select.

There is one toolset per domain; `service`, `run` and `request` are on by
default, and `instruction`, `worktree` and `history` are opt-in. A toolset
arrives with its first tool: one that no release carries yet is not a name
`toolsets` takes, and a tool that no release carries is not registered.

| Toolset       | Covers                                                              |
| ------------- | ------------------------------------------------------------------- |
| `service`     | what the service offers, and whether a directory is ready for a run |
| `run`         | starting, following, steering, stopping and copying a run           |
| `request`     | what a run is paused on, and answering it                           |
| `instruction` | the instruction entries a session keeps across turns                |
| `worktree`    | a worktree of its own for a write run                               |
| `history`     | sessions and token usage over a period                              |

A run is an OpenCode session the tools started under a role and bound to its
caller. A role names an OpenCode agent and a policy: a `read-only` run never
edits, and a `write` run edits only inside its worktree. What a tool reads
from a run is data, never instructions.

### `service`

| Tool                    | Class | Does                                                                                   |
| ----------------------- | ----- | -------------------------------------------------------------------------------------- |
| `opencode_service_read` | read  | the service and its version, its agents, models and roles, and a directory's readiness |

Its `method` says what to read:

| Method      | Reads                                                                                                    |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| `status`    | the service's version and the roles as they are configured, each with its agent, policy and model        |
| `agents`    | the agents of a directory, subagents and hidden ones included                                            |
| `providers` | the providers the service can use in a directory, and how many models each has                           |
| `models`    | the models of one provider with their variants, narrowed by `match`                                      |
| `ready`     | whether a directory is in a Git repository, a role's agent is a primary agent there and a model resolves |

A list holds at most 100 entries, keeps to a size and says when it left some
out. `ready` answers one line when nothing is wrong, and the findings
otherwise; an agent that is a subagent, or one OpenCode hides for its own
use, is a finding. No result holds the service's address, its password or a
value from OpenCode's configuration files; the roles are the tools' own
setting.

### `run`

| Tool                       | Class     | Does                                                                     |
| -------------------------- | --------- | ------------------------------------------------------------------------ |
| `opencode_run_read`        | read      | the caller's runs, one run's state, result, messages and changes; a wait |
| `opencode_run_start`       | add       | starts or continues a run under a role whose policy is `read-only`       |
| `opencode_run_start_write` | overwrite | starts or continues a run under a role whose policy is `write`           |
| `opencode_run_steer`       | add       | adds a message to a running turn                                         |
| `opencode_run_interrupt`   | overwrite | stops a running turn; nothing is rolled back                             |
| `opencode_run_fork`        | add       | copies an idle session, with its binding                                 |

### `request`

| Tool                     | Class     | Does                                                                               |
| ------------------------ | --------- | ---------------------------------------------------------------------------------- |
| `opencode_request_read`  | read      | what a run and its subagents are paused on, each with its whole command            |
| `opencode_request_reply` | overwrite | answers a permission request `once` or `reject`, or answers or declines a question |

### `instruction`

| Tool                          | Class     | Does                                             |
| ----------------------------- | --------- | ------------------------------------------------ |
| `opencode_instruction_read`   | read      | the instruction entries of a session             |
| `opencode_instruction_set`    | overwrite | sets an entry the session keeps across its turns |
| `opencode_instruction_remove` | overwrite | removes an entry                                 |

### `history`

| Tool                    | Class | Does                                                                |
| ----------------------- | ----- | ------------------------------------------------------------------- |
| `opencode_history_read` | read  | the sessions of a period and their token usage, never their content |

### Grants (`grants`)

Off by default. Delegates bounded writes for jobs where no person can answer.

| Tool                    | What it does                                             | Class          |
| ----------------------- | -------------------------------------------------------- | -------------- |
| `opencode_grant_create` | ask a person to delegate one tool's writes within limits | administrative |
| `opencode_grant_read`   | list grants and their use, or read the usage log         | read           |
| `opencode_grant_revoke` | remove a grant so no more calls run under it             | overwrite      |

Every write tool can be granted for its targets, calls per hour and expiry.
A tool adds what a grant can also limit by declaring `bounds` and giving
`measure(args, context)` in its spec: a ceiling (`max`), a yes or no
(`allow`), values from a list (`oneOf`) or the paths a value must sit under
(`prefix`); see the
[conventions](docs/conventions.md#writes-no-one-is-there-to-approve).

## Adding a tool

1. Write the spec in `src/core/<domain>/<verb>.ts` with `defineTool`: an ID
   `<prefix>_<domain>_<verb>`, a title and description, the Zod argument and
   output schemas, its toolset and write class, and `execute(args, context)`.
   A write tool also gives `targets(args, context)`: what the call writes to,
   as a permission rule should name it. A tool whose settings can put some
   calls out of reach whatever the person answers gives
   `gate(args, context)`, which throws for such a call; it is refused before
   anyone is asked, and before `execute`.
2. Test it beside the spec (`<verb>.test.ts`), calling it through `invoke` as
   the entry points do. A tool that runs a program is tested against a fake of
   that program on `PATH`; no test reaches a real service.
3. List it in `src/tools.ts`. A new toolset goes into `toolsets` in
   `src/project.ts` (and `defaultToolsets` when it is on by default), a
   setting of the package's own into `options` (and `OPTIONS` in `project.py`
   with `config_schema` in `plugin.yaml`), and a variable the tool reads
   besides the settings into `toolVariables`.
4. Add or update the toolset's skill, `skills/<prefix>-<toolset>/SKILL.md`,
   whose frontmatter names the toolset under `metadata`.
5. Run `pnpm run build && pnpm run manifests` to list the tool in
   `plugin.yaml` and its variables in Codex's manifest, then describe it under
   "Tools and skills".

[`docs/conventions.md`](docs/conventions.md) has the rules each step follows.

A package declares each option as `text`, `boolean`, `number`, `list`, `path`,
`paths` or `json`, or as an object with `type` and optional bounds. For
example, in `src/project.ts`:

```ts
options: {
  roles: "json",
  wait_seconds: { type: "number", integer: true, min: 1, max: 3300 },
}
```

`integer: true` requires a whole number; `min` and `max` bound a number or
count a `list` or `paths` value's items. An object with only `type` means the
same as the type alone. A `json` value is a JSON object, and what it must
hold is checked in `checkOptions` in `src/project.ts`. Hermes's `OPTIONS`
mirrors the declarations on one line, with double quotes and Python's `True`
for `integer`:

```python
OPTIONS: dict[str, str | dict[str, object]] = {"roles": "json", "wait_seconds": {"type": "number", "integer": True, "min": 1, "max": 3300}}
```

## Reads and writes

Every read tool is named `<prefix>_<domain>_read`. Reads can run unasked;
writes are confirmed by the harness.

| Harness     | Reads without asking                                                                                             |
| ----------- | ---------------------------------------------------------------------------------------------------------------- |
| Claude Code | the rule `mcp__plugin_opencode-tools_opencode-tools__*_read` in `permissions.allow` of `~/.claude/settings.json` |
| Codex       | always; Codex runs tools that declare `readOnlyHint` unasked, as the read tools do                               |
| Grok Build  | `grok --allow 'MCPTool(opencode-tools__*_read)' --allow 'MCPTool(opencode_*_read)'` (both rules; see below)      |
| Antigravity | the rule `mcp(opencode-tools_opencode-tools/<tool id>)` in `permissions.allow`, one for each read tool           |
| Hermes      | always; the plugin asks only before a write                                                                      |

Where a write is asked about, and where it is not:

- **Codex** asks before every write because of the plugin's approval mode.
  Under `codex exec` it refuses with "MCP tool call requires approval, but
  approval policy is never". For bounded jobs, see
  [Writes no one is there to approve](#writes-no-one-is-there-to-approve).
- **Grok Build** under `grok -p` refuses a write it cannot ask about, unless it
  is allowed beforehand.
- **Grok Build** calls the plugin's tools through its `use_tool` tool, and the
  agent often names a tool without its server first. Grok checks the rules
  against the name as given, so the server-qualified rule alone does not match
  that first call. The second rule matches the short name; a write still
  matches neither.
- **Antigravity** asks before any MCP tool no rule allows, reads included, and
  names the plugin's server `opencode-tools_opencode-tools` (plugin,
  then server). `agy -p` refuses a tool it cannot ask about.
- **Hermes** `hermes chat -q` refuses a write it cannot ask about; `hermes -z`
  and `--yolo` skip approval, so writes then run unasked. For bounded jobs, see
  [Writes no one is there to approve](#writes-no-one-is-there-to-approve).

A call a tool's `gate` refuses never runs, whatever the answer. Hermes
refuses it before it asks, so no prompt shows it, and blocks it with the
tool's error. Claude Code, Codex, Grok Build and Antigravity draw their
own prompt before the MCP server sees the call, so they may still ask about
it; the server then refuses it.

## Writes no one is there to approve

A grant limits a job's writes to one tool, for at most 90 days. The person
decides the rest: the targets (named ones, or `*` for any), the bounds the
tool declares (one left out is no limit) and the calls per hour (left out,
any number). Every call made under a grant is logged. A grant never
overrides the host's permissions. The
[conventions](docs/conventions.md#writes-no-one-is-there-to-approve) give the
contract.

1. In a session where a person answers, supply the key described under
   [Settings](#settings), turn on the `grants` toolset alongside the job's
   toolset, and ask the agent to delegate. It calls `opencode_grant_create`;
   the prompt shows the tool, targets, rate, days, every bound the tool
   declares (`no limit` for one left out) and the reason.
   Approve once.
2. Set the same key and `unattended` for the job only, for example
   `OPENCODE_TOOLS_UNATTENDED=true`. Otherwise grants are not checked.
3. Let the host allow the write tool in that run, as below. The grant still
   bounds each call.
4. Revoke with `opencode_grant_revoke`, or list grants and their use with
   `opencode_grant_read`.

What lets a write reach the package when no one can answer:

- **Claude Code** `claude -p` needs the tool in `--allowedTools`, as
  `mcp__plugin_opencode-tools_opencode-tools__opencode_note_create`.
- **Codex** `codex exec` needs `approval_mode = "approve"` for that tool under
  the plugin's MCP server in `config.toml`
  (`[mcp_servers.<server>.tools.<tool>]`), since the plugin's default asks
  before every write.
- **Grok Build** `grok -p` needs both allow rules:
  `--allow 'MCPTool(opencode-tools__opencode_note_create)'` and
  `--allow 'MCPTool(opencode_note_create)'`, for the qualified and short names
  described under [Reads and writes](#reads-and-writes).
- **Antigravity** `agy -p` needs
  `mcp(opencode-tools_opencode-tools/opencode_note_create)` in
  `permissions.allow`.
- **Hermes** `hermes chat -q` denies by `approvals.single_query_mode` unless
  allowed. `-z` and `--yolo` skip approvals and run the write; the grant is
  then the only bound.

### Limits

- A run with every approval skipped (Hermes `-z` or `--yolo`, an
  always-approve mode, or an explicit `allow` for `opencode_grant_create`)
  shows no prompt. A grant created there is not a
  person's answer, and it can be as wide as any target, no bound and no rate
  for 90 days: create grants only where the harness asks.
- An earlier copy of the grants directory put back whole is not detected.
  Expiry, at most 90 days, bounds what it can restore.
- Anyone who can read the key can sign grants. Keep it where the agent's
  tools cannot read it.

A Hermes gateway keeps the environment it started with; see
[Settings](#settings) before changing the job's variables.

## Settings

Every entry point takes the same settings. A flag wins over its environment
variable, and a setting in Hermes's configuration wins over the variable too.

| Setting           | Flag               | Variable                        | Meaning                                                                                                                           |
| ----------------- | ------------------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `toolsets`        | `--toolsets`       | `OPENCODE_TOOLS_TOOLSETS`       | the toolsets that are on, or `all`; default those `src/project.ts` names                                                          |
| `read_only`       | `--read-only`      | `OPENCODE_TOOLS_READ_ONLY`      | registers no tool that writes; wins over every other setting                                                                      |
| `unattended`      | `--unattended`     | `OPENCODE_TOOLS_UNATTENDED`     | no person can answer: a write runs only under a grant that covers it; off by default                                              |
| `grants_dir`      | `--grants-dir`     | `OPENCODE_TOOLS_GRANTS_DIR`     | where grants and their use are kept; default `$XDG_STATE_HOME/opencode-tools/grants`, else `~/.local/state/opencode-tools/grants` |
| `tools`           | `--tools`          | `OPENCODE_TOOLS_TOOLS`          | single tools to add by ID, whatever their toolset                                                                                 |
| `exclude_tools`   | `--exclude-tools`  | `OPENCODE_TOOLS_EXCLUDE_TOOLS`  | single tools to remove by ID; wins over `tools` and `toolsets`                                                                    |
| `confirm`         | `--confirm`        | `OPENCODE_TOOLS_CONFIRM`        | MCP server only: `harness` (default) or `elicitation`, as the conventions say                                                     |
| `caller`          | `--caller`         | `OPENCODE_TOOLS_CALLER`         | MCP server and command line: whose runs these are, at most 200 characters; unset, the MCP client's name, else `mcp`, or `cli`     |
| `language`        | `--language`       | `OPENCODE_TOOLS_LANGUAGE`       | Hermes only: the approval prompt's language, such as `ja`                                                                         |
| `emoji`           | —                  | —                               | Hermes only: the emoji shown beside each toolset, by toolset name (`""` for none)                                                 |
| `require_plugins` | —                  | —                               | Hermes only: the plugins that must be loaded; while one is not, every write is refused before it is approved                      |
| `roles`           | `--roles`          | `OPENCODE_TOOLS_ROLES`          | the roles a run can start under, as JSON; unset, `plan` (read-only) and `build` (write), OpenCode's own agents                    |
| `rules`           | `--rules`          | `OPENCODE_TOOLS_RULES`          | permission rules of your own for a run, per policy, as JSON; unset, none                                                          |
| `note`            | `--note`           | `OPENCODE_TOOLS_NOTE`           | text added to what every run is told; unset, none                                                                                 |
| `never_approve`   | `--never-approve`  | `OPENCODE_TOOLS_NEVER_APPROVE`  | the actions a request for which can only be rejected; unset, none                                                                 |
| `read_roots`      | `--read-roots`     | `OPENCODE_TOOLS_READ_ROOTS`     | directories a run may read outside its worktree; unset, none                                                                      |
| `output_roots`    | `--output-roots`   | `OPENCODE_TOOLS_OUTPUT_ROOTS`   | where a run's output directory may sit; unset, a run has none                                                                     |
| `protected_dirs`  | `--protected-dirs` | `OPENCODE_TOOLS_PROTECTED_DIRS` | checkouts no write run may start in; unset, none                                                                                  |
| `wait_seconds`    | `--wait-seconds`   | `OPENCODE_TOOLS_WAIT_SECONDS`   | how long one call may take as a whole, a wait included, in seconds; default 50, 1 to 3300                                         |

The settings from `roles` down are the package's own, and each arrives with
the tools that read it. `roles` and `rules` are maps: a mapping in Hermes's
configuration, and JSON text in a flag or a variable. A role names an
OpenCode agent and a policy, with an optional model and note:

```json
{
  "plan": { "agent": "plan", "policy": "read-only" },
  "build": { "agent": "build", "policy": "write", "model": "<provider>/<model>#<variant>" }
}
```

A role's name is a lowercase letter followed by up to 23 lowercase letters,
digits or underscores, and there are at most 20 roles. A role that breaks the
shape is refused when the settings are read, so no tool is registered until
it is fixed.

Under Hermes each session is a caller of its own: the plugin passes the
session's id and has no `caller` setting.

`OPENCODE_TOOLS_GRANT_KEY` is a variable only, never a flag or a setting. Use
at least 32 characters, for example from `openssl rand -hex 32`,
stored where the host keeps secrets. Without it no write runs while
unattended and no grant can be created. Codex forwards it alongside the
settings' variables, as described below.

Lists are comma-separated in a flag or a variable. A package's own settings,
listed in `options` in `src/project.ts`, take a row each here and are read the
same way. A `path` is trimmed; `~` and `~/…` (also with the platform separator)
stand for the home directory (`HOME` when it is absolute, else the account's).
It must then be absolute and reaches the tool normalized,
without a filesystem check. `paths` is a list of such paths, comma-separated
in a flag or variable and a list in Hermes's configuration. Blank paths
and lists with no items after trimming and dropping blanks count as unset.
Bounds check only a given value, not an unset option. Refused values are
`invalid_argument`, naming the flag or variable and what it must be.
Hermes passes paths and lists to the command line, which checks the paths and
bounds. Where each harness reads them:

- **Hermes** takes `plugins.entries.opencode-tools.settings` in
  `config.yaml`:

  ```yaml
  plugins:
    entries:
      opencode-tools:
        settings:
          read_only: false
          exclude_tools: []
  ```

  Without a `language` setting, the approval card follows Hermes's own
  `display.language` (or `HERMES_LANGUAGE`), the language of its approval
  buttons, and else stays in English. The plugin passes its own environment
  to the command line it runs, so the variables work too. A running gateway keeps the environment it started with;
  restart it (`hermes gateway restart`) after changing one.

- **Claude Code, Grok Build and Antigravity** start the plugin's server without
  flags and pass it the client's environment, so set the variables in the
  environment the harness runs in.
- **Codex** passes a plugin's MCP server only a few basic variables (such as
  `PATH` and `HOME`) and those the plugin's manifest names, which are the
  variables above: set them in the environment Codex runs in. A variable the
  tools read besides the settings belongs in `toolVariables` in
  `src/project.ts`; `pnpm run manifests` adds it to the manifest after the
  settings' variables. To pass flags, or to give the server a variable the
  package does not name, add the server under `[mcp_servers]` in Codex's
  `config.toml` instead of using the plugin: flags go in `args`, `env_vars`
  names the variables to forward from Codex's environment, and `env` sets
  fixed values.

  ```toml
  [mcp_servers.opencode-tools]
  command = "npx"
  args = ["-y", "@craftsamo/opencode-tools@<version>", "--read-only"]
  env_vars = ["OPENCODE_TOOLS_TOOLSETS"]
  ```

## Layout

- `src/project.ts` — the package's name, tool ID prefix, setting prefix,
  toolsets, tool options and the other variables its tools read.
- `src/core/` — the tool contract and the tools, free of any harness and of
  the project's names.
- `src/tools.ts` — the list of every tool, which each entry point registers.
- `src/words.ts` — the translations of the tools' words, per language, which
  the Hermes plugin uses in its approval prompts.
- `src/mcp/` — the MCP server, built to `dist/mcp.js` and run by
  `opencode-tools`.
- `src/cli/` — the command line the Hermes plugin calls, built to `dist/cli.js`
  and run by `opencode-tools-cli`.
- `src/hermes/`, `plugin.yaml` and `__init__.py` — the Hermes plugin.
- `skills/` — one skill per toolset, `skills/<name>/SKILL.md`, which every
  harness that takes skills loads from the package or plugin root; the Hermes
  plugin loads only those of the toolsets that are on.
- `.claude-plugin/`, `.codex-plugin/`, `.agents/plugins/`, `.mcp.json`,
  `.antigravity-plugin/` and `mcp_config.json` — the plugin manifests of the
  other harnesses. Codex reads `.codex-plugin/plugin.json`; a root
  `plugin.json` would make it load the plugin as an Agent Plugin, whose tool
  budget hides tools past a fixed size. The root `.mcp.json` is the
  configuration Grok Build reads (with `${CLAUDE_PLUGIN_ROOT}`, the variable
  both Grok Build and Claude Code expand); when working on this repository in
  Claude Code, decline the project MCP server it offers from that file.

How a release is made is in [`RELEASING.md`](RELEASING.md).

## License

[AGPL-3.0 with Commons Clause](LICENSE)
