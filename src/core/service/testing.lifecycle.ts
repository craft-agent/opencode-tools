/**
 * What a session of the fake service (see `testing.ts`) goes through, shared
 * by its routes and the helpers that play a turn: a blank session, the steps
 * that deliver the inbox, the start and the end of a turn. Typed by the
 * client's own types; uses no test runner's API.
 */
import type {
  SessionInboxDelivery,
  SessionMessageIdle,
  SessionMessageInfo,
  SessionMessageSynthetic,
  SessionStructuredError,
} from "@opencode/client"
import type { FakeInboxItem, FakeSession, FakeSessionState } from "./testing.sessions"

/** The delivery whose items a session's next step takes out of its inbox. */
const STEER = "steer" satisfies SessionInboxDelivery
/** What a background job says it is when nothing named it: a subagent's task. */
export const SUBAGENT_DESCRIPTION = "Subagent task"

/** A session with nothing in it but its identity and its times: what a route or a test adds to. */
export function blankSession(init: { id: string; projectID: string; directory: string; now: number }): FakeSession {
  return {
    id: init.id,
    projectID: init.projectID,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: init.now, updated: init.now },
    location: { directory: init.directory },
    prompts: [],
    inbox: [],
    entries: {},
    messages: [],
    pending: [],
    forms: [],
    answers: [],
    settled: [],
    asked: 0,
    diff: [],
  }
}

/** The id of the message a session's next turn writes, after those it holds. */
export function nextMessageId(session: FakeSession): string {
  return `${session.id}:message${session.messages.length + 1}`
}

function messageOf(item: FakeInboxItem, now: number): SessionMessageInfo {
  const time = { created: now }
  if (item.type === "user") return { id: item.id, time, type: "user", text: item.payload.text }
  return {
    id: item.id,
    time,
    type: "synthetic",
    text: item.payload.text,
    ...(item.payload.description !== undefined && { description: item.payload.description }),
  } satisfies SessionMessageSynthetic
}

/** Takes every `steer` item out of the session's inbox, in order, and appends it as a message at `now`; the queued stay. Returns the messages it added. */
export function deliverSteers(session: FakeSession, now: number): SessionMessageInfo[] {
  const delivered = session.inbox.filter((item) => item.delivery === STEER).map((item) => messageOf(item, now))
  session.inbox = session.inbox.filter((item) => item.delivery !== STEER)
  session.messages.push(...delivered)
  return delivered
}

/** Takes the session out of the active set. */
export function deactivate(state: FakeSessionState, sessionID: string): void {
  state.active = state.active.filter((id) => id !== sessionID)
}

/** Starts a turn of the session at `now`: active and busy, with the steers waiting in its inbox delivered. Returns the messages that added. */
export function startTurn(state: FakeSessionState, session: FakeSession, now: number): SessionMessageInfo[] {
  if (!state.active.includes(session.id)) state.active.push(session.id)
  session.time.busy = now
  return deliverSteers(session, now)
}

/** Ends the session's turn at `now`: the `idle` message, the outcome and idle time, out of the active set, and the job that was running it, if it is a subagent, gone from the list. */
export function endTurn(
  state: FakeSessionState,
  session: FakeSession,
  now: number,
  outcome: SessionMessageIdle["outcome"],
  error?: SessionStructuredError,
): void {
  session.messages.push({
    id: nextMessageId(session),
    time: { created: now },
    type: "idle",
    outcome,
    ...(error !== undefined && { error }),
  })
  session.outcome = outcome
  session.time.idle = now
  session.time.updated = now
  deactivate(state, session.id)
  state.jobs = state.jobs.filter((job) => job.kind !== "subagent" || job.childSessionID !== session.id)
}
