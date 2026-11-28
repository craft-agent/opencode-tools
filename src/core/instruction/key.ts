import { ToolError } from "../errors"
import { BINDING_KEY } from "../run/binding"
import { NOTE_KEY } from "../run/note"

/** What the key of every entry the package owns starts with. */
export const KEY_PREFIX = `${BINDING_KEY}.`
/** The most characters of the name after the prefix. */
export const MAX_ENTRY_NAME = 40
/** The form of the name after the prefix. */
export const ENTRY_NAME_PATTERN = `[a-z0-9][a-z0-9_-]{0,${MAX_ENTRY_NAME - 1}}`

const KEY_FORM = new RegExp(`^${BINDING_KEY}\\.${ENTRY_NAME_PATTERN}$`)

/** What the call does with the key: a read may name the operating note, a write may not. */
export type KeyUse = "read" | "write"

/** Whether the key is one of the package's entries: it starts with the prefix, whatever follows. */
export function isPackageKey(key: string): boolean {
  return key.startsWith(KEY_PREFIX)
}

/**
 * Checks what the key alone decides, so that a mistake starts no service: a
 * key is `<prefix><name>` given whole, else `invalid_argument` with the reason
 * `key`; the operating note is refused as `forbidden` with the reason
 * `reserved` for a write.
 */
export function checkKey(key: string, use: KeyUse): void {
  if (!KEY_FORM.test(key)) {
    throw new ToolError(
      "invalid_argument",
      `key must be written whole as ${KEY_PREFIX}<name>, the name of 1 to ${MAX_ENTRY_NAME} lower-case letters, digits, "_" and "-", starting with a letter or a digit.`,
      { details: { reason: "key" } },
    )
  }
  if (use === "write" && key === NOTE_KEY) {
    throw new ToolError(
      "forbidden",
      `${NOTE_KEY} is the operating note: every start writes it again, so it cannot be set or removed.`,
      { details: { reason: "reserved" } },
    )
  }
}
