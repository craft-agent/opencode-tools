/**
 * The routes of the fake service (see `testing.ts`) that act on a running
 * session or on the jobs it started: an interrupt, the cancel of an inbox
 * item, the list of jobs and their cancel. What a real OpenCode 2.4.2 service
 * was seen to answer, typed by the client's own types; uses no test runner's
 * API.
 */
import type {
  ExperimentalJobListOutput,
  JobShell,
  JobStatus,
  SessionInboxSynthetic,
  SessionInfo,
  SessionInterruptResponse,
  SessionMessageAssistant,
  SessionMessageToolStateError,
} from "@opencode/client"
import { endTurn, startTurn, SUBAGENT_DESCRIPTION } from "./testing.lifecycle"
import type { FakePlayer } from "./testing.play"
import type { Call, FakeReply, FakeSession } from "./testing.sessions"

const HTTP_OK = 200
const HTTP_NO_CONTENT = 204

const NO_CONTENT: FakeReply = { status: HTTP_NO_CONTENT }
const DESCENDANTS_QUERY = "true"
/** The error type of a step, a tool call and a job that was stopped from outside. */
const ABORTED = "aborted"
const STEP_INTERRUPTED = "Step interrupted"
const TOOL_INTERRUPTED = "Tool execution interrupted"
const CANCELLED = "cancelled" satisfies JobStatus

/** What a report says of the work that was stopped, by the kind of job. */
const RESULT_LABELS: Record<"subagent" | "shell", string> = { subagent: "Subagent", shell: "Shell" }

/** What a control route needs of the service around it: its state and clock, the ids it hands out and what a session reads back as. */
export type ControlContext = FakePlayer & {
  newMessageId: () => string
  newSessionId: () => string
  report: (session: FakeSession) => SessionInfo
}

/** A route of one existing session: the router answers an unknown one itself. `call.params` are the path's captures, the session's id first. */
export type ControlRoute = [
  method: string,
  pattern: RegExp,
  handler: (session: FakeSession, call: Call, context: ControlContext) => FakeReply,
]

/** A route that names no session. */
export type JobRoute = [method: string, pattern: RegExp, handler: (call: Call, context: ControlContext) => FakeReply]

/** The background work a report tells a session of: what kind it was, the session it names, and what it was for. */
type Report = { kind: keyof typeof RESULT_LABELS; sessionID: string; description: string }

function ok(body: unknown): FakeReply {
  return { status: HTTP_OK, body }
}

/** Puts a `steer` report of stopped work into the inbox of `target` and, when `target` is not running, wakes it: its waiting steers, the report among them, become messages. */
function sendReport(context: ControlContext, target: FakeSession, report: Report): void {
  const now = context.clock.now
  const { kind, sessionID, description } = report
  const text = `<background-result kind="${kind}" sessionID="${sessionID}" state="${CANCELLED}" description="${description}">\n${RESULT_LABELS[kind]} cancelled\n</background-result>`
  target.inbox.push({
    id: context.newMessageId(),
    sessionID: target.id,
    time: { created: now },
    type: "synthetic",
    payload: { text, description, metadata: {} },
    delivery: "steer",
  } satisfies SessionInboxSynthetic)
  if (!context.state.active.includes(target.id)) startTurn(context.state, target, now)
}

/** Settles the newest assistant message that is not completed as the service does when its step is cut off: completed now, finished with an error, and its running tool calls failed. */
function abortStep(session: FakeSession, now: number): void {
  const step = [...session.messages]
    .reverse()
    .find(
      (message): message is SessionMessageAssistant =>
        message.type === "assistant" && message.time.completed === undefined,
    )
  if (step === undefined) return
  step.time.completed = now
  step.finish = "error"
  step.error = { type: ABORTED, message: STEP_INTERRUPTED }
  for (const part of step.content) {
    if (part.type !== "tool" || part.state.status !== "running") continue
    part.state = {
      status: "error",
      input: part.state.input,
      error: { type: ABORTED, message: TOOL_INTERRUPTED },
      metadata: part.state.metadata,
    } satisfies SessionMessageToolStateError
  }
}

/**
 * Interrupts a session as the service settles it: when it is running, its
 * step is aborted, its requests and forms are gone, its turn ends as
 * `interrupted` and, when it is a child, the report of it goes to its parent.
 * Its inbox and its own children are left as they are. Returns whether it was
 * running.
 */
function interruptSession(session: FakeSession, context: ControlContext): boolean {
  const { state, clock } = context
  if (!state.active.includes(session.id)) return false
  const job = state.jobs.find((candidate) => candidate.kind === "subagent" && candidate.childSessionID === session.id)
  abortStep(session, clock.now)
  session.pending = []
  session.forms = []
  endTurn(state, session, clock.now, "interrupted")
  const parent = state.sessions.find((candidate) => candidate.id === session.parentID)
  if (parent) {
    const description = job?.kind === "subagent" ? job.description : SUBAGENT_DESCRIPTION
    sendReport(context, parent, { kind: "subagent", sessionID: session.id, description })
  }
  return true
}

/** The `resume` query of the interrupt is not modelled: the turn ends and nothing is resumed. Unknown session: the router's 404. */
function interrupt(session: FakeSession, _call: Call, context: ControlContext): FakeReply {
  return ok({ interrupted: interruptSession(session, context) } satisfies SessionInterruptResponse)
}

/** Removes an inbox item that is there, and answers the same when it is not. */
function cancelInboxItem(session: FakeSession, { params }: Call): FakeReply {
  session.inbox = session.inbox.filter((item) => item.id !== params[1])
  return NO_CONTENT
}

/** The ids of a session and of every session below it by `parentID`. */
function withDescendants(sessions: readonly FakeSession[], rootID: string): Set<string> {
  const found = new Set([rootID])
  let size = 0
  while (found.size > size) {
    size = found.size
    for (const session of sessions) {
      if (session.parentID !== undefined && found.has(session.parentID)) found.add(session.id)
    }
  }
  return found
}

/** The jobs of the session the `sessionID` query names, with `descendants=true` those below it too, else all of them; narrowed by `kind` and `status`. */
function listJobs({ query }: Call, { state }: ControlContext): FakeReply {
  const scope =
    query.sessionID === undefined
      ? undefined
      : query.descendants === DESCENDANTS_QUERY
        ? withDescendants(state.sessions, query.sessionID)
        : new Set([query.sessionID])
  const data = state.jobs.filter(
    (job) =>
      (scope === undefined || scope.has(job.sessionID)) &&
      (query.kind === undefined || job.kind === query.kind) &&
      (query.status === undefined || job.status === query.status),
  )
  return ok({ data } satisfies { data: ExperimentalJobListOutput })
}

function stopShell(job: JobShell, context: ControlContext): void {
  const owner = context.state.sessions.find((session) => session.id === job.sessionID)
  if (owner) sendReport(context, owner, { kind: "shell", sessionID: owner.id, description: job.command })
}

/**
 * Takes the job off the list, and an id that is not there answers the same.
 * A shell job tells its session of it, which wakes when it is not running. A
 * subagent job interrupts its child session; that is not seen on a real
 * service, which this follows from what an interrupt of the child does.
 */
function cancelJob({ params }: Call, context: ControlContext): FakeReply {
  const { state } = context
  const job = state.jobs.find((candidate) => candidate.id === params[0])
  if (!job) return NO_CONTENT
  if (job.kind === "shell") stopShell(job, context)
  if (job.kind === "subagent") {
    const child = state.sessions.find((session) => session.id === job.childSessionID)
    if (child) interruptSession(child, context)
  }
  state.jobs = state.jobs.filter((candidate) => candidate !== job)
  return NO_CONTENT
}

/** The routes that act on one running session. */
export const CONTROL_ROUTES: ControlRoute[] = [
  ["POST", /^\/api\/session\/([^/]+)\/interrupt$/, interrupt],
  ["DELETE", /^\/api\/session\/([^/]+)\/inbox\/([^/]+)$/, cancelInboxItem],
]

/** The routes of the jobs, which name no session. */
export const JOB_ROUTES: JobRoute[] = [
  ["GET", /^\/api\/experimental\/job$/, listJobs],
  ["POST", /^\/api\/experimental\/job\/([^/]+)\/cancel$/, cancelJob],
]
