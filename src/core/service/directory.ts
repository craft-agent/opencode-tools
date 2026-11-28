import { isAbsolute, normalize, parse, sep } from "node:path"
import { ToolError } from "../errors"
import { isWithin } from "../paths"
import { shown } from "../text"
import type { ToolContext } from "../tool"

/** How much of a directory a message shows. */
export const MAX_SHOWN_DIRECTORY = 300
/** The most characters of a directory a call may name, or work in. */
export const MAX_DIRECTORY = 4096

function invalid(message: string): ToolError {
  return new ToolError("invalid_argument", message)
}

function withoutTrailingSeparator(directory: string): string {
  const { root } = parse(directory)
  let trimmed = directory
  while (trimmed.length > root.length && trimmed.endsWith(sep)) trimmed = trimmed.slice(0, -1)
  return trimmed
}

/**
 * The directory a call asks the service about: the `directory` argument, else
 * the call's working directory. Whichever it is, it must be an absolute path
 * of at most `MAX_DIRECTORY` characters, without a NUL character, and it is refused when it lies within the directory
 * the tools are installed in, which is never a project. The directory itself
 * is not looked at: the service answers for one that does not exist.
 */
export async function directoryOf(
  args: { directory?: string },
  ctx: Pick<ToolContext, "cwd" | "ownDir">,
): Promise<string> {
  const given = args.directory !== undefined
  const effective = args.directory ?? ctx.cwd
  if (effective.length > MAX_DIRECTORY) throw invalid(`directory must be at most ${MAX_DIRECTORY} characters.`)
  if (!isAbsolute(effective)) {
    throw invalid(
      given
        ? "directory must be an absolute path."
        : "The call's working directory is not an absolute path; pass directory.",
    )
  }
  if (effective.includes("\0")) throw invalid("directory must not contain a NUL character.")
  const directory = given ? withoutTrailingSeparator(normalize(effective)) : effective
  if (ctx.ownDir !== undefined && (await isWithin(directory, ctx.ownDir))) {
    throw invalid(
      `${shown(directory, MAX_SHOWN_DIRECTORY)} is where these tools are installed, not a project; pass directory, or make the call from the project's directory.`,
    )
  }
  return directory
}
