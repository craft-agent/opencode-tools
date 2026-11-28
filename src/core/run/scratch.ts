import { realpath } from "node:fs/promises"
import { isAbsolute, join } from "node:path"

/** Where OpenCode keeps its data under a data directory. */
const DATA_NAME = "opencode"
/** Where a data directory is when `XDG_DATA_HOME` does not say. */
const DEFAULT_DATA_PARTS = [".local", "share"] as const
/** Where the service keeps a command's output, and a tool's output, under its data directory. */
const OUTPUT_NAMES = ["shell", "tool-output"] as const

/**
 * The directories the service sends a run to: the scratch directory it
 * reports, and where it keeps a command's output and a tool's output. A run
 * reads them back, so asking for each would stop it on its own output.
 * `<data>` is `XDG_DATA_HOME` when that is an absolute path, else
 * `<HOME>/.local/share`; with neither, only `tmp` is returned.
 */
export function scratchDirectories(
  env: Readonly<Record<string, string | undefined>>,
  tmp: string | undefined,
): string[] {
  const directories = tmp === undefined ? [] : [tmp]
  const dataHome = dataHomeOf(env)
  if (dataHome === undefined) return directories
  return [...directories, ...OUTPUT_NAMES.map((name) => join(dataHome, DATA_NAME, name))]
}

function dataHomeOf(env: Readonly<Record<string, string | undefined>>): string | undefined {
  const { XDG_DATA_HOME: xdg, HOME: home } = env
  if (xdg !== undefined && isAbsolute(xdg)) return xdg
  if (home !== undefined && home !== "") return join(home, ...DEFAULT_DATA_PARTS)
  return undefined
}

/**
 * Each directory as given and, where it differs, as the file system resolves
 * it (on macOS `/var/…` is `/private/var/…`): the service matches a path as
 * text, so a run may reach it under either spelling. One that does not exist
 * is kept as given. Deduplicated, order kept.
 */
export async function withResolved(directories: readonly string[]): Promise<string[]> {
  const spellings = await Promise.all(
    directories.map(async (directory) => {
      try {
        return [directory, await realpath(directory)]
      } catch {
        return [directory]
      }
    }),
  )
  return [...new Set(spellings.flat())]
}
