import { randomUUID } from "node:crypto"
import { isToolError } from "../errors"
import type { ServiceConnection } from "../service/connect"
import { admittedOf } from "../service/reply"
import { NOTE_KEY } from "./note"
import type { NotePlace, StartState } from "./start.schemas"

/** What the service's ids of messages start with. */
const MESSAGE_ID_PREFIX = "msg_"

/** What a start says when it cannot tell whether the service took the brief. */
export const UNCONFIRMED_ADMISSION =
  "The prompt's admission could not be confirmed. Read the session before anything else, and do not send the brief again."

/**
 * Puts the operating note on the session as its instruction entry. Where the
 * service refuses the entry or lacks its route, and the call still has time,
 * the note is to head the brief instead. A cancelled call, or one whose time
 * has ended, fails as it would anywhere.
 */
export async function placeNote(service: ServiceConnection, sessionID: string, note: string): Promise<NotePlace> {
  try {
    await service.client.experimental.session.instructions.entry.put({ sessionID, key: NOTE_KEY, value: note })
    return "entry"
  } catch (error) {
    if (!isToolError(error) || service.deadline.remaining() <= 0) throw error
    return "prompt"
  }
}

/** The text a start sends: the brief, headed by the note when the note could not be an entry. */
export function textOf(brief: string, note: string, place: NotePlace): string {
  return place === "prompt" ? `${note}\n\n${brief}` : brief
}

/**
 * Sends the brief once, queued, with an id made here (the service takes a
 * prompt of one id once). A failure that leaves it open whether the service
 * took the brief, every `upstream_error`, is `unknown`, never an error of the
 * call and never a reason to send again. A refusal, and a call that was
 * cancelled, are thrown as they are.
 */
export async function sendBrief(service: ServiceConnection, sessionID: string, text: string): Promise<StartState> {
  const id = `${MESSAGE_ID_PREFIX}${randomUUID().replaceAll("-", "")}`
  try {
    admittedOf(await service.client.session.prompt({ sessionID, id, text, delivery: "queue" }))
    return "running"
  } catch (error) {
    if (isToolError(error) && error.code === "upstream_error") return "unknown"
    throw error
  }
}
