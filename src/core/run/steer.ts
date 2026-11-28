import { ToolError, isToolError } from "../errors"
import type { ServiceConnection } from "../service/connect"
import { cleaned } from "../service/errors"
import { admittedOf, type SessionEntry } from "../service/reply"
import { inboxOf } from "../service/reply.control"
import type { ToolContext } from "../tool"
import type { Binding } from "./binding"
import { ownedSession } from "./owned"
import { observeRun } from "./read.observe"
import { rosterOf, type Roster } from "./roster"
import { newMessageId } from "./start.prompt"
import type { SteerInput, SteerOutput, SteerWhen } from "./steer.schemas"
import { lookAtRun, summarizeRun } from "./summary"

/** What the error says when the service may or may not have taken the steer. */
const ADMISSION_UNCONFIRMED = "The steer's admission could not be confirmed"
/** What the error says when the steer was taken but what became of it is not known. */
const FATE_UNCONFIRMED = "The steer was sent, but whether the run read it could not be confirmed"

/** A run that is not running: the steer has nothing to join. `why` says how it was found. */
function notRunning(sessionID: string, why: string): ToolError {
  return new ToolError("invalid_argument", `Session ${cleaned(sessionID)} ${why}; a steer needs a turn in flight.`, {
    details: { reason: "not_running" },
  })
}

/** The error of a step after which it is open whether the steer is taken: the service's text, and what to do. */
function unconfirmed(what: string, error: ToolError): ToolError {
  return new ToolError(
    "upstream_error",
    `${what} (${cleaned(error.message)}). Read the run before sending the message again.`,
  )
}

/** Runs `step`, and turns an `upstream_error` of it into the error of a steer whose fate is open, as `what` says. */
async function unlessUnconfirmed<T>(what: string, step: () => Promise<T>): Promise<T> {
  try {
    return await step()
  } catch (error) {
    if (isToolError(error) && error.code === "upstream_error") throw unconfirmed(what, error)
    throw error
  }
}

/**
 * Checks what the arguments alone decide, so that a mistake starts no service
 * and sends no request: the message must not be blank.
 */
export function checkSteer(args: SteerInput): void {
  if (args.message.trim() === "") throw new ToolError("invalid_argument", "message must not be blank.")
}

/**
 * The run's own session and binding, and a roster read just now, for a run of
 * which a session (its own or a subagent's) is in the service's active set;
 * a run that is not running is refused as `not_running`.
 */
export async function requireRunning(
  service: ServiceConnection,
  sessionID: string,
  ctx: Pick<ToolContext, "caller">,
): Promise<{ session: SessionEntry; binding: Binding; roster: Roster }> {
  const { session, binding } = await ownedSession(service, sessionID, ctx.caller)
  const roster = rosterOf(service, [session])
  await roster.refresh()
  if ((await roster.membersOf(session.id)).length === 0) throw notRunning(session.id, "is not running")
  return { session, binding, roster }
}

/** Whether the session holds a message `messageID`: an item of its inbox that was read is one. */
async function isMessage(service: ServiceConnection, sessionID: string, messageID: string): Promise<boolean> {
  try {
    await service.client.session.message.get({ sessionID, messageID })
    return true
  } catch (error) {
    if (isToolError(error) && error.code === "not_found") return false
    throw error
  }
}

/**
 * Looks once at what became of the steer `id`: read when it is no longer in
 * the inbox; else, with something of the run active, at its next step, or once
 * the request its own session is paused on is answered; else the turn ended
 * first, and the message is withdrawn, since it would arrive with a later turn
 * nobody connects with it. A message that became a message meanwhile was read.
 */
async function whenRead(
  service: ServiceConnection,
  roster: Roster,
  session: SessionEntry,
  id: string,
  ctx: Pick<ToolContext, "runtime">,
): Promise<SteerWhen> {
  const sessionID = session.id
  const { client } = service
  if (!inboxOf(await client.session.inbox.list({ sessionID })).some((item) => item.id === id)) return "read"

  await roster.refresh()
  if ((await roster.membersOf(sessionID)).length > 0) {
    const { requests } = await observeRun(service, roster, session, ctx, { rootFresh: true, readIdleRoot: false })
    return requests.some((request) => request.session === sessionID) ? "after_request" : "next_step"
  }

  await client.session.inbox.cancel({ sessionID, inboxID: id })
  if (await isMessage(service, sessionID, id)) return "read"
  throw notRunning(sessionID, "ended its turn before it read the message, which was withdrawn")
}

/**
 * Sends the message to the run's own session as a steer that starts no turn,
 * once, with an id made here, and says when the run reads it. An
 * `upstream_error` of the send or of the look leaves open whether the service
 * took the message, and is told so. The run is read after the send, so a
 * failure to read it is the result's `run_error`.
 */
export async function steerRun(service: ServiceConnection, args: SteerInput, ctx: ToolContext): Promise<SteerOutput> {
  checkSteer(args)
  const { session, binding, roster } = await requireRunning(service, args.session, ctx)
  const id = newMessageId()
  await unlessUnconfirmed(ADMISSION_UNCONFIRMED, async () =>
    admittedOf(
      await service.client.session.prompt({
        sessionID: session.id,
        id,
        text: args.message,
        delivery: "steer",
        resume: false,
      }),
    ),
  )
  const when = await unlessUnconfirmed(FATE_UNCONFIRMED, () => whenRead(service, roster, session, id, ctx))
  return {
    service_started: service.started,
    session: session.id,
    when,
    ...(await summarizeRun(service, binding, ctx, () => lookAtRun(service, session, ctx))),
  }
}
