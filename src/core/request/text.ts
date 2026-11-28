import { MAX_TEXT_LENGTH } from "../describe"
import { ACTION } from "../run/patterns"
import { multilineOf } from "../run/read.text"
import { idFits } from "../service/listing"
import type { ToolCallEntry } from "../service/reply.request"

/** The most code points of a request's text an approval's prompt shows. */
export const MAX_APPROVAL_TEXT = MAX_TEXT_LENGTH

/** What a request is asked about: its action, its resources and the tool call that asked, when it could be read. */
export type RequestFacts = { action: string; resources: readonly string[]; call?: ToolCallEntry }

/**
 * What an approval lets run: the whole command of a shell call, else the
 * call's arguments as JSON, else (no call to read) the resources, one to a
 * line. Raw: neither cut nor cleaned.
 */
export function approvalTextOf({ action, resources, call }: RequestFacts): string {
  const command = call?.input?.command
  if (action === ACTION.shell && typeof command === "string") return command
  if (call?.input !== undefined) return JSON.stringify(call.input)
  return resources.join("\n")
}

/** Whether a text can be shown as it is: it holds nothing that `multilineOf` would replace or drop, a line break and a tab aside. */
export function isShowable(text: string): boolean {
  return multilineOf(text) === text
}

/** Whether a text an answer must repeat, such as a field's key or an option's value, can be given as it is: it fits an id, and can be shown. */
export function isRepeatable(text: string): boolean {
  return idFits(text) && isShowable(text)
}
