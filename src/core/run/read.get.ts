import { modelText } from "../role"
import type { ServiceConnection } from "../service/connect"
import { messagesOf, type RetryEntry } from "../service/reply.run"
import { MAX_ID } from "../service/schemas"
import type { ToolContext } from "../tool"
import type { Binding } from "./binding"
import { ownedSession } from "./owned"
import { observeRun, sessionGone, type Observation, type PendingRequest } from "./read.observe"
import { pickRetry, readRetries } from "./read.retry"
import {
  MAX_RESOURCES,
  MAX_RESULT,
  MAX_RUN_NAME,
  MAX_WAITING_ON,
  MAX_WAITING_TEXT,
  RESULT_PAGE,
  type CallOf,
  type RunReadOutput,
} from "./read.schemas"
import { blockOf, errorOf, lineOf } from "./read.text"
import { readTurn } from "./read.turn"
import { rosterOf } from "./roster"
import { turnEnded } from "./state"
import { sessionIfThere } from "./tree"

/** The requests a result lists: the first `MAX_WAITING_ON`, their texts cut, and how many there are when more. */
function waitingFields(requests: readonly PendingRequest[]): Pick<RunReadOutput, "waiting_on" | "waiting_total"> {
  if (requests.length === 0) return {}
  const waiting_on = requests.slice(0, MAX_WAITING_ON).map((request) =>
    request.kind === "permission"
      ? {
          kind: request.kind,
          id: request.id,
          session: request.session,
          action: lineOf(request.action, MAX_WAITING_TEXT),
          resources: request.resources.slice(0, MAX_RESOURCES).map((resource) => lineOf(resource, MAX_WAITING_TEXT)),
        }
      : {
          kind: request.kind,
          id: request.id,
          session: request.session,
          title: lineOf(request.title, MAX_WAITING_TEXT),
        },
  )
  return { waiting_on, ...(requests.length > MAX_WAITING_ON && { waiting_total: requests.length }) }
}

/**
 * The result `get` and `wait` return for a run as it was observed: its
 * identity, its state and what the state says, the requests it waits on, the
 * provider call it retries (read now, unless a wait already has the one it
 * handed back) and the newest turn's reply and error, read from the session's
 * newest messages. The session is read again when the look left it as it was,
 * so that the reply is cut from the turn the session now has.
 */
export async function describeRun(
  service: ServiceConnection,
  method: "get" | "wait",
  binding: Binding,
  observed: Observation,
  handedBack?: RetryEntry,
): Promise<RunReadOutput> {
  const root = observed.fresh ? observed.root : await sessionIfThere(service, observed.root.id)
  if (root === undefined) throw sessionGone()
  const { state, resumes, message } = observed.state

  const page = messagesOf(await service.client.message.list({ sessionID: root.id, limit: RESULT_PAGE, order: "desc" }))
  const turn = readTurn(page, turnEnded(root))
  const reply = turn.reply === undefined ? undefined : blockOf(turn.reply, MAX_RESULT)
  const retry =
    state === "running" ? (handedBack ?? pickRetry(await readRetries(service, root.id, observed.members))) : undefined
  const title = root.title === undefined ? "" : lineOf(root.title, MAX_RUN_NAME)

  return {
    method,
    service_started: service.started,
    session: root.id,
    ...(title !== "" && { title }),
    role: binding.role,
    ...(root.agent !== undefined && { agent: lineOf(root.agent, MAX_RUN_NAME) }),
    ...(root.model !== undefined && { model: lineOf(modelText(root.model), MAX_ID) }),
    directory: root.directory,
    branch: binding.branch,
    state,
    ...waitingFields(observed.requests),
    ...(retry !== undefined && { retry: { attempt: retry.attempt, at: retry.at, error: errorOf(retry.error) } }),
    ...(reply !== undefined && { result: reply.text, ...(reply.cut && { result_truncated: true }) }),
    ...(state === "failed" && turn.endError !== undefined && { error: errorOf(turn.endError) }),
    ...(resumes && { resumes }),
    ...(message !== undefined && { message }),
  }
}

/** Method `get`: one run's state, what it waits on and the reply of its newest turn. */
export async function readGet(
  checked: CallOf<"get">,
  service: ServiceConnection,
  ctx: ToolContext,
): Promise<RunReadOutput> {
  const { session, binding } = await ownedSession(service, checked.session, ctx.caller)
  const roster = rosterOf(service, [session])
  await roster.refresh()
  const observed = await observeRun(service, roster, session, ctx, { rootFresh: true, readIdleRoot: true })
  return describeRun(service, "get", binding, observed)
}
