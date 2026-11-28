/**
 * The characters that move, hide or reorder text when it is shown: C0 and C1
 * controls, the line and paragraph separators, the bidirectional controls (the
 * Arabic letter mark among them) and the byte order mark. A global pattern:
 * use it with `replace`, not `test`.
 */
export const UNSAFE_CHARACTERS =
  /[\u0000-\u001f\u007f-\u009f\u061c\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g

const DEFAULT_SHOWN_LENGTH = 40
const HEX_RADIX = 16
const ESCAPE_DIGITS = 4

function escaped(character: string): string {
  return `\\u${character.charCodeAt(0).toString(HEX_RADIX).padStart(ESCAPE_DIGITS, "0")}`
}

/**
 * The text cut to its first `limit` code points and quoted, so it is safe in a
 * message: `JSON.stringify` escapes the controls it knows, and every other
 * character of `UNSAFE_CHARACTERS` is written as a `\uXXXX` escape, so nothing
 * in the result moves or reorders text.
 */
export function shown(text: string, limit = DEFAULT_SHOWN_LENGTH): string {
  return JSON.stringify([...text].slice(0, limit).join("")).replace(UNSAFE_CHARACTERS, escaped)
}
