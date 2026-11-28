import {
  MAX_NEVER_APPROVE,
  MAX_WAIT_SECONDS,
  MIN_WAIT_SECONDS,
  SERVICE_ENV,
  consumerRulesOf,
  neverApproveOf,
  noteOf,
  protectedDirsOf,
  readRootsOf,
  rolesOf,
  type OptionSpec,
  type ToolOptions,
} from "./core"

/** What makes this package itself; a project made from the starter sets these once (the setup script does). */
export const PROJECT = {
  /** The plugin, MCP server and program name. */
  name: "opencode-tools",
  /** The command line the Hermes plugin calls. */
  cli: "opencode-tools-cli",
  /** Every tool ID starts with `<toolPrefix>_`. */
  toolPrefix: "opencode",
  /** Every setting's environment variable is `<envPrefix>_<SETTING>`. */
  envPrefix: "OPENCODE_TOOLS",
  /** The toolsets, in the order `all` lists them. */
  toolsets: ["service", "run"] as readonly string[],
  /** The toolsets on when a setting names none. */
  defaultToolsets: ["service", "run"] as readonly string[],
  /** The package's own settings, which the tools themselves read: each snake_case name and its type, with bounds when it needs them. */
  options: {
    roles: "json",
    wait_seconds: { type: "number", integer: true, min: MIN_WAIT_SECONDS, max: MAX_WAIT_SECONDS },
    note: "text",
    rules: "json",
    never_approve: { type: "list", max: MAX_NEVER_APPROVE },
    read_roots: { type: "paths", max: 20 },
    protected_dirs: { type: "paths", max: 50 },
  } as Readonly<Record<string, OptionSpec>>,
  /** Checks what the package's own settings hold, when they are read: a role that breaks its shape is refused there. */
  checkOptions(options: ToolOptions): void {
    rolesOf(options)
    noteOf(options)
    consumerRulesOf(options)
    neverApproveOf(options)
    readRootsOf(options)
    protectedDirsOf(options)
  },
  /** The environment variables the tools read besides the settings, which Codex forwards to the server after them. */
  toolVariables: [...SERVICE_ENV] as readonly string[],
} as const
