import { z } from "zod"
import { read } from "./reply"

/** An id a result uses: an empty one names nothing. */
const id = z.string().min(1)

const inboxItem = z.looseObject({ id, type: z.string(), delivery: z.string() })
const job = z.looseObject({ kind: z.string(), id, sessionID: id, status: z.string() })

/** An item of a session's inbox, which waits for the session's next step. */
export type InboxEntry = z.output<typeof inboxItem>
/** A job the service runs for a session: a background command, a subagent or another kind. */
export type JobEntry = z.output<typeof job>

/** Whether a `session.interrupt` reply says that a running session was stopped. */
export function interruptedOf(reply: unknown): boolean {
  return read(z.looseObject({ interrupted: z.boolean() }), reply).interrupted
}

/** The items of a `session.inbox.list` reply. */
export function inboxOf(reply: unknown): InboxEntry[] {
  return read(z.array(inboxItem), reply)
}

/** The jobs of an `experimental.job.list` reply. */
export function jobsOf(reply: unknown): JobEntry[] {
  return read(z.array(job), reply)
}
