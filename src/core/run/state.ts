import type { SessionEntry } from "../service/reply"

/** How long a turn with no end written, or a prompt not yet taken up, still counts as running: the service writes both a moment after the fact. */
export const SETTLING_MS = 30_000

/** Every state a run can be read in. */
export const RUN_STATES = ["running", "waiting", "completed", "failed", "interrupted", "unknown"] as const

/** What a run is doing, as `docs/conventions.md` defines it under "State and waiting". */
export type RunState = (typeof RUN_STATES)[number]

/** What the result says of a turn that stopped without its end. */
export const INTERRUPTED_MESSAGE =
  "The turn stopped without its end: a request was rejected without a message, or the service stopped. OpenCode takes it up again when the service next starts."
/** What the result says of a session that holds no turn. */
export const NO_TURN_MESSAGE = "The session holds no turn."

const STATE_OF_OUTCOME = {
  succeeded: "completed",
  failed: "failed",
  interrupted: "interrupted",
} as const satisfies Record<NonNullable<SessionEntry["outcome"]>, RunState>

/** The facts of a run its state is read from; the caller does the reads. */
export type StateFacts = {
  /** The run's own session: its times and its newest outcome. */
  session: Pick<SessionEntry, "time" | "outcome">
  /** The clock, in the unit of the session's times. */
  now: number
  /** Whether some session of the run has a pending permission request or question. */
  waiting: boolean
  /** Whether some session of the run is in the service's active set. */
  active: boolean
  /** When the newest item of the session's inbox was created; absent for an empty inbox, or one that was not read (`needsInbox`). */
  inboxCreated?: number
}

/** A run's state, with what to say when the state needs saying. */
export type StateResult = { state: RunState; resumes?: true; message?: string }

/** The outcome of the session's newest turn when it has its end: its idle time is set and not older than its busy time, and the service wrote an outcome with it. */
function endedOutcome(session: Pick<SessionEntry, "time" | "outcome">): SessionEntry["outcome"] {
  const { busy, idle } = session.time
  return idle !== undefined && (busy === undefined || idle >= busy) ? session.outcome : undefined
}

/** Whether the session's newest turn has its end. */
export function turnEnded(session: Pick<SessionEntry, "time" | "outcome">): boolean {
  return endedOutcome(session) !== undefined
}

/** Whether `runState` needs the session's inbox: only where nothing else has settled the state. */
export function needsInbox(facts: Pick<StateFacts, "session" | "waiting" | "active">): boolean {
  return !facts.waiting && !facts.active && !turnEnded(facts.session)
}

function settling(createdAt: number, now: number): boolean {
  return now - createdAt < SETTLING_MS
}

/**
 * The state of a run. A pending request wins over everything, and what the
 * service runs wins over any outcome, since a session keeps its previous
 * turn's outcome while the next one runs. Only then are the session's times
 * read: a turn that ended gives its outcome; one that has no end is `running`
 * while its newest sign (when it was busy, or its newest inbox item) is less
 * than `SETTLING_MS` old and `interrupted` after that; a session that was
 * never busy is `running` while a prompt that is not yet taken up is that
 * young, and `unknown` otherwise.
 */
export function runState(facts: StateFacts): StateResult {
  const { session, now, inboxCreated } = facts
  if (facts.waiting) return { state: "waiting" }
  if (facts.active) return { state: "running" }
  const outcome = endedOutcome(session)
  if (outcome !== undefined) return { state: STATE_OF_OUTCOME[outcome] }
  const { busy } = session.time
  if (busy !== undefined) {
    const newestSign = inboxCreated === undefined ? busy : Math.max(busy, inboxCreated)
    return settling(newestSign, now)
      ? { state: "running" }
      : { state: "interrupted", resumes: true, message: INTERRUPTED_MESSAGE }
  }
  if (inboxCreated !== undefined && settling(inboxCreated, now)) return { state: "running" }
  return { state: "unknown", message: NO_TURN_MESSAGE }
}
