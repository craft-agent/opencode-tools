import type { Rule } from "./rule"

/**
 * The actions the service names its rules by. `shell` is matched against one
 * simple command as written, `edit` and `read` against a path, and
 * `external_directory` against `<directory>/*` for a path outside the
 * session's directory.
 */
export const ACTION = {
  shell: "shell",
  edit: "edit",
  read: "read",
  externalDirectory: "external_directory",
  sessionMove: "opencode_session_move",
} as const

/** The resource that matches anything: a tool of an MCP server is asked as `<server>_<tool>` with this resource. */
export const ANY_RESOURCE = "*"

/** The effect of a rule: the service allows, refuses or asks a person or caller. */
type Effect = Rule["effect"]

/**
 * What can stand before a git subcommand without changing what it does.
 * Options that change the repository or the configuration (`-C`, `-c`,
 * `--git-dir`) are not here: they are denied as commands of their own, so a
 * pattern never has to guess at the text between `git` and its subcommand.
 */
const GIT_PREFIXES = ["*git ", "*git --no-pager ", "*git -P ", "*git --no-optional-locks "] as const

/** The text a pattern finds anywhere in a command. */
function has(text: string): string {
  return `*${text}*`
}

/**
 * Four shell patterns that find `git <sub>` wherever it stands in the text
 * (after a variable, in `bash -c '…'`), with only the options before the
 * subcommand that change nothing. The rules match text, so each spelling is
 * written out.
 */
function git(sub: string): string[] {
  return GIT_PREFIXES.map((prefix) => `${prefix}${sub}*`)
}

/**
 * The same four spellings for a subcommand that is the start of harmless
 * longer ones (`merge` against `merge-base`): the subcommand must end the
 * command, or be followed by a space, a quote or a redirect.
 */
function gitWord(sub: string): string[] {
  return GIT_PREFIXES.flatMap((prefix) => [
    `${prefix}${sub}`,
    `${prefix}${sub} *`,
    `${prefix}${sub}'*`,
    `${prefix}${sub}"*`,
    `${prefix}${sub}>*`,
  ])
}

/**
 * Four shell patterns that find a command where a command can begin: at the
 * start of the text, after a space (a variable or a wrapper before it) or
 * after a quote (`bash -c '…'`), and followed by a space. Unlike `has`, it
 * does not find the command inside a longer word.
 */
function command(text: string): string[] {
  return [`${text} *`, `* ${text} *`, `*'${text} *`, `*"${text} *`]
}

/** One rule of the same action and effect for each resource. */
export function rulesOf(action: string, effect: Effect, resources: readonly string[]): Rule[] {
  return resources.map((resource) => ({ action, resource, effect }))
}

/** Pushing from a shell: the request would show a command, not the commits, so it is denied rather than asked. */
const PUSHING = [...git("push"), ...git("send-pack")]

/** Git configuration set by a command, on its line or through the environment. */
const GIT_CONFIGURATION = [...git("config"), "*git -c *", "*git --config-env*", "*GIT_CONFIG*"]

/** The options that point git at a repository other than the one the run is bound to. */
const OTHER_REPOSITORY = ["*git -C *", "*git --git-dir*", "*git --work-tree*"]

/** Commands that throw work away without asking git to be careful. */
const FORCED_DISCARD = [
  "*git reset*--hard*",
  ...git("clean"),
  "*git checkout*--force*",
  "*git checkout* -f*",
  "*git switch*--force*",
  "*git switch* -f*",
  "*git switch*--discard-changes*",
  ...git("stash drop"),
  ...git("stash clear"),
  "*git branch* -D*",
]

/** Publishing a package: a program of a package manager or registry, found anywhere in a command. */
const PUBLISHING = [
  "npm publish",
  "pnpm publish",
  "yarn publish",
  "yarn npm publish",
  "bun publish",
  "cargo publish",
  "twine upload",
  "gem push",
  "poetry publish",
  "uv publish",
].map(has)

/** Files that hold a secret; `*` crosses `/`, so each also matches a file at the top level. */
const SECRET_FILES = [
  "*.env",
  "*.env.*",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "*id_rsa",
  "*id_ed25519",
  "*id_ecdsa",
  "*.netrc",
  "*.npmrc",
  "*.pypirc",
]

/** Sample files hold no secret and a repository documents its settings in them, so reading them is allowed again after the rule above. */
const SAMPLE_FILES = ["*.env.example", "*.env.sample", "*.env.template"]

/**
 * A shell command that names an environment file. A space or a slash is asked
 * for before `.env` where a suffix follows, so `process.env.X` in a script is
 * not found.
 */
const SECRET_FILES_BY_SHELL = ["* .env", "* .env *", "* .env.*", "*/.env", "*/.env *", "*/.env.*", "*.env", "*.env *"]

/** A repository's git directory and a person's git configuration: where hooks and settings are, by the edit tools. */
const GIT_PATHS = [".git", ".git/*", "*/.git", "*/.git/*", "*.gitconfig"]

/** The domains of the package's own tools, as `<prefix>_<domain>_<verb>`. */
const PACKAGE_DOMAINS = ["service", "run", "request", "instruction", "worktree", "history"]

/**
 * The package's own tools under any server's name: a tool of an MCP server is
 * `<server>_<tool>` and the person chooses the server's name. The leading
 * `*_` needs a name, so OpenCode's own tools (`opencode_worktree_create`),
 * which have none before them, stay as they are.
 */
const PACKAGE_TOOLS = PACKAGE_DOMAINS.map((domain) => `*_opencode_${domain}_*`)

/**
 * What every run is denied, whatever its policy. It comes last in a session's
 * rules, so no rule before it, a consumer's included, reopens it. The three
 * allows are the sample files, which follow the rule they are cut from.
 */
export const EVERY_RUN: readonly Rule[] = [
  ...rulesOf(ACTION.shell, "deny", [
    ...PUSHING,
    ...GIT_CONFIGURATION,
    ...OTHER_REPOSITORY,
    ...FORCED_DISCARD,
    ...PUBLISHING,
  ]),
  ...rulesOf(ACTION.read, "deny", SECRET_FILES),
  ...rulesOf(ACTION.edit, "deny", SECRET_FILES),
  ...rulesOf(ACTION.read, "allow", SAMPLE_FILES),
  ...rulesOf(ACTION.shell, "deny", SECRET_FILES_BY_SHELL),
  ...rulesOf(ACTION.edit, "deny", GIT_PATHS),
  ...PACKAGE_TOOLS.flatMap((action) => rulesOf(action, "deny", [ANY_RESOURCE])),
  ...rulesOf(ACTION.sessionMove, "deny", [ANY_RESOURCE]),
]

/** The git commands that write, denied for a read-only run. The shell stays open for the rest, as under OpenCode's own `plan` agent. */
export const READ_ONLY_GIT: readonly string[] = [
  ...[
    "add",
    "am",
    "apply",
    "checkout",
    "cherry-pick",
    "commit",
    "mv",
    "pull",
    "rebase",
    "reset",
    "restore",
    "revert",
    "rm",
    "stash",
    "switch",
    "init",
    "worktree add",
    "worktree remove",
    "worktree move",
    "worktree prune",
    "update-ref",
    "update-index",
    "branch -d",
    "branch -D",
    "branch -m",
    "branch -M",
    "branch -f",
    "branch --delete",
    "branch --move",
    "branch --force",
    "tag -d",
    "tag -a",
    "tag -s",
    "tag -f",
    "tag --delete",
  ].flatMap(git),
  ...gitWord("merge"),
]

/** What rewrites history or moves a branch, which a write run is asked before. */
const HISTORY_REWRITES = [
  ...["rebase", "reset", "checkout", "switch", "filter-branch", "filter-repo", "update-ref"].flatMap(git),
  "*git commit*--amend*",
  "*git branch* -f*",
  "*git branch* -m*",
  "*git branch* -M*",
  "*git branch*--force*",
  "*git branch*--move*",
]

/**
 * Commands that download a package and run it in one step. Each is looked for
 * as a word of its own: `npm exec` is inside `pnpm exec`, which runs only what
 * the project installed and is not asked about.
 */
const PACKAGE_RUNNERS = [
  "npx",
  "pnpx",
  "npm exec",
  "npm create",
  "npm init",
  "pnpm dlx",
  "pnpm create",
  "yarn dlx",
  "yarn create",
  "bunx",
  "bun x",
  "bun create",
  "uvx",
  "uv tool run",
  "pipx run",
].flatMap(command)

/** The shell commands a write run is asked before: it may commit and merge, and asks to rewrite history or to run a downloaded package. */
export const WRITE_ASK: readonly string[] = [...HISTORY_REWRITES, ...PACKAGE_RUNNERS]
