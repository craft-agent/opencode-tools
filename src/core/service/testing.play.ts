/**
 * Helpers for tests to play a turn on the fake service (see `testing.ts`):
 * what an agent's work leaves in a session, one step at a time, so a test
 * states the moment it checks. Typed by the client's own types; uses no test
 * runner's API.
 */
import type {
  FormInfo,
  PermissionRequest,
  SessionMessageAssistant,
  SessionMessageIdle,
  SessionStructuredError,
} from "@opencode/client"
import { blankSession, fakeSession, type FakeSession, type FakeSessionState } from "./testing.sessions"

/** What the helpers need of the fake service: what it holds and its clock. */
export type FakePlayer = { state: FakeSessionState; clock: { now: number } }

const AGENT = "plan"
const MODEL = { providerID: "acme", id: "model-1" }

function assistantOf(session: FakeSession, now: number): SessionMessageAssistant {
  return {
    id: `${session.id}:message${session.messages.length + 1}`,
    time: { created: now },
    type: "assistant",
    agent: session.agent ?? AGENT,
    model: session.model ?? MODEL,
    content: [],
  }
}

/** Appends an assistant message that is completed and holds `text` as its one text part, at the clock; returns it so a test can change it, such as give it an `error`. */
export function fakeReply(service: FakePlayer, sessionID: string, text: string): SessionMessageAssistant {
  const session = fakeSession(service, sessionID)
  const message = assistantOf(session, service.clock.now)
  message.time.completed = service.clock.now
  message.content.push({ type: "text", text })
  session.messages.push(message)
  return message
}

/** Ends the session's turn as the service does: the `idle` message, the session's outcome and idle time at the clock, and out of the active set. */
export function fakeEnd(
  service: FakePlayer,
  sessionID: string,
  outcome: SessionMessageIdle["outcome"],
  error?: SessionStructuredError,
): void {
  const session = fakeSession(service, sessionID)
  const now = service.clock.now
  session.messages.push({
    id: `${session.id}:message${session.messages.length + 1}`,
    time: { created: now },
    type: "idle",
    outcome,
    ...(error !== undefined && { error }),
  })
  session.outcome = outcome
  session.time.idle = now
  session.time.updated = now
  fakeStop(service, sessionID)
}

/** Takes the session out of the active set with no end written: a turn that stopped, as when the service did. */
export function fakeStop(service: FakePlayer, sessionID: string): void {
  service.state.active = service.state.active.filter((id) => id !== sessionID)
}

/** Pauses the session on a permission request; returns it. */
export function fakeAsk(
  service: FakePlayer,
  sessionID: string,
  request: Pick<PermissionRequest, "action" | "resources">,
): PermissionRequest {
  const session = fakeSession(service, sessionID)
  const asked: PermissionRequest = { id: `${session.id}:request${session.pending.length + 1}`, sessionID, ...request }
  session.pending.push(asked)
  return asked
}

/** Pauses the session on a question: a form with `title` and one text field; returns it. */
export function fakeQuestion(service: FakePlayer, sessionID: string, title: string): FormInfo {
  const session = fakeSession(service, sessionID)
  const form: FormInfo = {
    id: `${session.id}:form${session.forms.length + 1}`,
    sessionID,
    title,
    fields: [{ key: "answer", type: "string" }],
  }
  session.forms.push(form)
  return form
}

/** Marks the session's newest assistant message as retrying its provider, adding an unfinished one when it has none. */
export function fakeRetry(
  service: FakePlayer,
  sessionID: string,
  retry: NonNullable<SessionMessageAssistant["retry"]>,
): void {
  const session = fakeSession(service, sessionID)
  const newest = [...session.messages]
    .reverse()
    .find((message): message is SessionMessageAssistant => message.type === "assistant")
  if (newest !== undefined) {
    newest.retry = retry
    return
  }
  const added = assistantOf(session, service.clock.now)
  added.retry = retry
  session.messages.push(added)
}

/** A subagent's session: a child of `parentID` in its directory with the parent's metadata and permissions copied, active and busy at the clock. */
export function fakeChild(service: FakePlayer, parentID: string): FakeSession {
  const parent = fakeSession(service, parentID)
  const now = service.clock.now
  const siblings = service.state.sessions.filter((session) => session.parentID === parentID).length
  const child: FakeSession = {
    ...blankSession({
      id: `${parentID}_child${siblings + 1}`,
      projectID: parent.projectID,
      directory: parent.location.directory,
      now,
    }),
    parentID,
    ...(parent.agent !== undefined && { agent: parent.agent }),
    ...(parent.metadata !== undefined && { metadata: structuredClone(parent.metadata) }),
    ...(parent.permissions !== undefined && { permissions: structuredClone(parent.permissions) }),
  }
  child.time.busy = now
  service.state.sessions.push(child)
  service.state.active.push(child.id)
  return child
}
