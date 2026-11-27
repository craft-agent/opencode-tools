import { rolesOf, type OptionSpec, type ToolOptions } from "./core"

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
  toolsets: [] as readonly string[],
  /** The toolsets on when a setting names none. */
  defaultToolsets: [] as readonly string[],
  /** The package's own settings, which the tools themselves read: each snake_case name and its type, with bounds when it needs them. */
  options: { roles: "json" } as Readonly<Record<string, OptionSpec>>,
  /** Checks what the package's own settings hold, when they are read: a role that breaks its shape is refused there. */
  checkOptions(options: ToolOptions): void {
    rolesOf(options)
  },
  /** The environment variables the tools read besides the settings, which Codex forwards to the server after them. */
  toolVariables: [] as readonly string[],
} as const
