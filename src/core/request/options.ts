import { ToolError } from "../errors"
import type { ToolOptions } from "../tool"

/** The most patterns the `never_approve` setting may hold. */
export const MAX_NEVER_APPROVE = 50
/** The most characters of one pattern. */
export const MAX_ACTION_PATTERN = 200

const CONTROL_CHARACTER = /\p{Cc}/u

function invalid(message: string): ToolError {
  return new ToolError("invalid_argument", message)
}

function isPattern(value: string): boolean {
  return value !== "" && value.length <= MAX_ACTION_PATTERN && !CONTROL_CHARACTER.test(value)
}

/** The `never_approve` setting: at most `MAX_NEVER_APPROVE` action patterns, trimmed and without duplicates. Unset gives none. */
export function neverApproveOf(options: ToolOptions | undefined): readonly string[] {
  const configured: unknown = options?.never_approve
  if (configured === undefined) return []
  if (!Array.isArray(configured) || !configured.every((item) => typeof item === "string")) {
    throw invalid(`Setting "never_approve" must be a list of action patterns.`)
  }
  if (configured.length > MAX_NEVER_APPROVE) {
    throw invalid(
      `Setting "never_approve" has ${configured.length} patterns; at most ${MAX_NEVER_APPROVE} are allowed.`,
    )
  }
  const patterns = configured.map((item: string, position) => {
    const pattern = item.trim()
    if (!isPattern(pattern)) {
      throw invalid(
        `Setting "never_approve", pattern ${position + 1}, must be non-empty text without control characters, at most ${MAX_ACTION_PATTERN} characters.`,
      )
    }
    return pattern
  })
  return [...new Set(patterns)]
}
