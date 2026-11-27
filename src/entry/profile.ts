import { GRANTS_TOOLSET, type OptionSpec, type ToolOptions, type Toolsets } from "../core"
import { PROJECT } from "../project"

/** What an entry point takes from the package's identity: its name (the state directory's), the prefix of its settings' environment variables, its toolsets and the types of its tool options, with their bounds. */
export type EntryProfile = {
  name: string
  envPrefix: string
  toolsets: Toolsets
  options?: Readonly<Record<string, OptionSpec>>
  /** Checks what the options hold beyond their types and throws `invalid_argument`; runs whenever the settings are read. */
  check?: (options: ToolOptions) => void
}

/** The profile of this package, which every entry point uses unless a test supplies its own. */
export const PROJECT_PROFILE: EntryProfile = {
  name: PROJECT.name,
  envPrefix: PROJECT.envPrefix,
  toolsets: { names: [...PROJECT.toolsets, GRANTS_TOOLSET], defaults: PROJECT.defaultToolsets },
  options: PROJECT.options,
  check: PROJECT.checkOptions,
}
