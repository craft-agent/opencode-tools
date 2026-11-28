import { cut } from "../describe"
import { UNSAFE_CHARACTERS } from "../text"

/**
 * A text a run wrote, which is data, on one line, without anything that moves
 * or reorders text, and cut to `limit` code points, with `…` where it was.
 * `lineOf` of `opencode_run_read` holds a line to 300 characters; the limits
 * here go up to 500.
 */
export function shortLine(text: string, limit: number): string {
  return cut(text.replace(UNSAFE_CHARACTERS, " ").trim(), limit)
}

/** `{ [key]: line }` for a text that is not blank once it is a `shortLine`; nothing for an absent or blank one. */
export function lineFor<Key extends string>(
  key: Key,
  text: string | undefined,
  limit: number,
): Partial<Record<Key, string>> {
  const line = text === undefined ? "" : shortLine(text, limit)
  return (line === "" ? {} : { [key]: line }) as Partial<Record<Key, string>>
}
