/**
 * Matches a rule as OpenCode 2.4.2 does: a copy of the service's matcher, which
 * a later version can leave behind. The tools decide by it only to withhold an
 * approval, never to grant one (see "Answers" in the conventions).
 */
import type { Rule } from "./rule"

/** Options of `matches`. */
export type MatchOptions = {
  /** Fold case, as the service does for `read`, `edit` and `external_directory` on macOS. */
  ignoreCase?: boolean
}

function slashed(text: string): string {
  return text.replaceAll("\\", "/")
}

/**
 * Whether a wildcard pattern matches the whole value: `*` is any text,
 * `/` and newlines included, `?` is one character, and a trailing ` *` also
 * matches the text without it (`git push *` matches `git push`).
 */
export function matches(pattern: string, value: string, options: MatchOptions = {}): boolean {
  let source = slashed(pattern)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  if (source.endsWith(" .*")) source = `${source.slice(0, -3)}( .*)?`
  const flags = options.ignoreCase === true ? "si" : "s"
  return new RegExp(`^${source}$`, flags).test(slashed(value))
}

/** The effect of the last rule whose action and resource patterns both match; `undefined` when none does. */
export function lastEffect(rules: readonly Rule[], action: string, resource: string): Rule["effect"] | undefined {
  let effect: Rule["effect"] | undefined
  for (const rule of rules) {
    if (matches(rule.action, action) && matches(rule.resource, resource)) effect = rule.effect
  }
  return effect
}
