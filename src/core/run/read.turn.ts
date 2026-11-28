import type { MessageEntry, StructuredError } from "../service/reply.run"

/** What the newest turn of a session left in its messages. */
export type TurnReading = {
  /** The text of the newest reply of the turn that was completed and has no error; absent when there is none, or it has no text. */
  reply?: string
  /** The error its idle message carries, when the turn ended with one. */
  endError?: StructuredError
}

/**
 * Reads the newest turn from the newest messages, newest first. A turn is
 * everything after the idle message before it. When the turn `ended`, its own
 * idle message is the first one on the page and belongs to it; otherwise the
 * first idle message found is the end of the turn before, and the page stops
 * there. A turn longer than the page is read as far as the page goes.
 */
export function readTurn(newestFirst: readonly MessageEntry[], ended: boolean): TurnReading {
  let ownEndPending = ended
  const reading: TurnReading = {}
  let replyFound = false
  for (const message of newestFirst) {
    if (message.type === "idle") {
      if (!ownEndPending) break
      ownEndPending = false
      if (message.error !== undefined) reading.endError = message.error
    } else if (
      !replyFound &&
      message.type === "assistant" &&
      message.completed !== undefined &&
      message.error === undefined
    ) {
      replyFound = true
      if (message.text !== undefined) reading.reply = message.text
    }
  }
  return reading
}
