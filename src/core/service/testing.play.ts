/**
 * Helpers for tests to play a turn on the fake service (see `testing.ts`):
 * what an agent's work leaves in a session, one step at a time, so a test
 * states the moment it checks. Typed by the client's own types; uses no test
 * runner's API.
 */
import type {
  FormField,
  FormInfo,
  JobShell,
  JobSubagent,
  JsonValue,
  PermissionRequest,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageIdle,
  SessionMessageInfo,
  SessionStructuredError,
} from "@opencode/client"
import {
  blankSession,
  deactivate,
  deliverSteers,
  endTurn,
  nextMessageId,
  SUBAGENT_DESCRIPTION,
} from "./testing.lifecycle"
import { fakeSession, type FakeSession, type FakeSessionState } from "./testing.sessions"

/** What the helpers need of the fake service: what it holds and its clock. */
export type FakePlayer = { state: FakeSessionState; clock: { now: number } }

/** A question of the agent's question tool: a short header, the question, the options it offers and whether it takes several. */
type FakeQuestion = { header: string; question: string; options: string[]; multiple?: boolean }

const AGENT = "plan"
/** The agent a subagent's job names when its session has none. */
const SUBAGENT = "scout"
const MODEL = { providerID: "acme", id: "model-1" }
/** The title of every form the agent's question tool makes. */
const QUESTIONS_TITLE = "Questions"

function assistantOf(session: FakeSession, now: number): SessionMessageAssistant {
  return {
    id: nextMessageId(session),
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

/** Ends the session's turn as the service does: the `idle` message, the session's outcome and idle time at the clock, out of the active set, and, for a subagent's session, its job gone from the list. */
export function fakeEnd(
  service: FakePlayer,
  sessionID: string,
  outcome: SessionMessageIdle["outcome"],
  error?: SessionStructuredError,
): void {
  endTurn(service.state, fakeSession(service, sessionID), service.clock.now, outcome, error)
}

/** Takes the session out of the active set with no end written: a turn that stopped, as when the service did. */
export function fakeStop(service: FakePlayer, sessionID: string): void {
  deactivate(service.state, sessionID)
}

/** The session takes a step: every `steer` item of its inbox leaves it and becomes a message at the clock, in order, and the queued stay; returns the messages it added. */
export function fakeStep(service: FakePlayer, sessionID: string): SessionMessageInfo[] {
  return deliverSteers(fakeSession(service, sessionID), service.clock.now)
}

/** Pauses the session on a permission request; returns it. */
export function fakeAsk(
  service: FakePlayer,
  sessionID: string,
  request: Pick<PermissionRequest, "action" | "resources"> &
    Partial<Pick<PermissionRequest, "save" | "metadata" | "message" | "source">>,
): PermissionRequest {
  const session = fakeSession(service, sessionID)
  session.asked += 1
  const asked: PermissionRequest = { id: `${session.id}:request${session.asked}`, sessionID, ...request }
  session.pending.push(asked)
  return asked
}

/** Pauses the session on a request for a tool call: adds the running call to `step`, else to a new assistant message at the clock, and a request that names it; returns the request. */
export function fakeToolAsk(
  service: FakePlayer,
  sessionID: string,
  ask: {
    tool: string
    input: Record<string, JsonValue>
    action: string
    resources: string[]
    save?: string[]
    metadata?: PermissionRequest["metadata"]
    step?: SessionMessageAssistant
  },
): PermissionRequest {
  const session = fakeSession(service, sessionID)
  const now = service.clock.now
  let step = ask.step
  if (step === undefined) {
    step = assistantOf(session, now)
    session.messages.push(step)
  }
  const calls = step.content.filter((part) => part.type === "tool").length
  const call: SessionMessageAssistantTool = {
    type: "tool",
    id: `${step.id}:call${calls + 1}`,
    name: ask.tool,
    state: { status: "running", input: ask.input, metadata: {} },
    time: { created: now },
  }
  step.content.push(call)
  return fakeAsk(service, sessionID, {
    action: ask.action,
    resources: ask.resources,
    ...(ask.save !== undefined && { save: ask.save }),
    ...(ask.metadata !== undefined && { metadata: ask.metadata }),
    source: { type: "tool", messageID: step.id, id: call.id },
  })
}

function addForm(session: FakeSession, form: Omit<FormInfo, "id" | "sessionID">): FormInfo {
  session.asked += 1
  const added: FormInfo = { id: `${session.id}:form${session.asked}`, sessionID: session.id, ...form }
  session.forms.push(added)
  return added
}

/** Pauses the session on a question: a form with `title` and `fields`, one text field by default; returns it. */
export function fakeQuestion(
  service: FakePlayer,
  sessionID: string,
  title: string,
  fields: FormInfo["fields"] = [{ key: "answer", type: "string" }],
): FormInfo {
  return addForm(fakeSession(service, sessionID), { title, fields })
}

/** Pauses the session on a form as the agent's question tool makes it: one field `q<i>` per question, a single choice or, with `multiple`, a multiselect, each taking an answer of its own; returns it. */
export function fakeQuestions(service: FakePlayer, sessionID: string, questions: FakeQuestion[]): FormInfo {
  const [first, ...rest] = questions
  if (first === undefined) throw new Error("A form needs at least one question")
  const fields: FormInfo["fields"] = [
    questionField(first, 0),
    ...rest.map((question, index) => questionField(question, index + 1)),
  ]
  return addForm(fakeSession(service, sessionID), { title: QUESTIONS_TITLE, metadata: { kind: "question" }, fields })
}

function questionField({ header, question, options, multiple }: FakeQuestion, index: number): FormField {
  const field = {
    key: `q${index}`,
    title: header,
    description: question,
    options: options.map((value) => ({ value, label: value, description: `Choose ${value}` })),
    custom: true,
  }
  return multiple ? { ...field, type: "multiselect" } : { ...field, type: "string" }
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

/** A subagent's session: a child of `parentID` in its directory with the parent's metadata and permissions copied and no instruction entries, active and busy at the clock, and the running subagent job that lists it. */
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
  service.state.jobs.push({
    kind: "subagent",
    id: child.id,
    sessionID: parentID,
    status: "running",
    time: { started: now },
    childSessionID: child.id,
    agent: child.agent ?? SUBAGENT,
    description: SUBAGENT_DESCRIPTION,
  } satisfies JobSubagent)
  return child
}

/** A command the session moved to the background: adds the running shell job, numbered after the jobs the session has, and returns it. */
export function fakeJob(service: FakePlayer, sessionID: string, command: string): JobShell {
  fakeSession(service, sessionID)
  const held = service.state.jobs.filter((job) => job.sessionID === sessionID && job.kind === "shell").length
  const id = `${sessionID}:job${held + 1}`
  const job = {
    kind: "shell",
    id,
    sessionID,
    status: "running",
    title: command,
    time: { started: service.clock.now },
    shellID: id,
    command,
  } satisfies JobShell
  service.state.jobs.push(job)
  return job
}
