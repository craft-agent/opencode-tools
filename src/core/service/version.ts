import { ToolError } from "../errors"

/** The oldest OpenCode version whose routes the tools rely on. */
export const MIN_SERVICE_VERSION = "2.4.2"

/** How much of a reported version a message shows. */
const SHOWN_VERSION_LENGTH = 40
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/s
const NOT_PRINTABLE_ASCII = /[^\x20-\x7e]/g
/** How OpenCode writes a development build's version: `0.0.0-<channel>-<time>`. */
const DEVELOPMENT_BUILD = /^0\.0\.0-/

function parts(version: string): [number, number, number] | undefined {
  const match = VERSION_PATTERN.exec(version)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined
}

const MINIMUM = parts(MIN_SERVICE_VERSION)!

/**
 * Refuses a service older than `MIN_SERVICE_VERSION` with `upstream_error`.
 * Versions compare by number, not text. A development build's version is not
 * refused, since nothing says what it holds: one not written `x.y.z`, and one
 * written `0.0.0-…` (the form OpenCode gives a development build). A bare
 * `0.0.0` is a release number and is refused, as is `0.0.1-dev`.
 */
export function checkServiceVersion(version: string): void {
  const found = parts(version)
  if (found === undefined || DEVELOPMENT_BUILD.test(version)) return
  for (const [index, number] of found.entries()) {
    if (number > MINIMUM[index]!) return
    if (number < MINIMUM[index]!) {
      const shown = version.replace(NOT_PRINTABLE_ASCII, "").slice(0, SHOWN_VERSION_LENGTH)
      throw new ToolError(
        "upstream_error",
        `OpenCode ${shown} is running; these tools need ${MIN_SERVICE_VERSION} or later.`,
      )
    }
  }
}
