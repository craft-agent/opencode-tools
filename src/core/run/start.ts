import { startDeadline } from "../deadline"
import { isToolError } from "../errors"
import { modelText, type Policy, type Role } from "../role"
import { runtimeOf } from "../runtime"
import { withService, type ServiceConnection } from "../service/connect"
import { loadLocation } from "../service/location"
import type { ToolContext } from "../tool"
import { noteFor } from "./note"
import { noteOf } from "./options"
import { refuseBusy, refuseRivalStart } from "./start.busy"
import { checkStart } from "./start.checks"
import { bindingFor, modelOfStart, resolveStartRole, rulesetFor } from "./start.plan"
import { UNCONFIRMED_ADMISSION, placeNote, sendBrief, textOf } from "./start.prompt"
import type { NotePlace, StartInput, StartOutput, StartState } from "./start.schemas"
import {
  createSession,
  reconfigureSession,
  readBack,
  removeSession,
  unmarkSession,
  type SessionSetup,
} from "./start.setup"
import { continuedTarget, newTarget, type StartTarget } from "./start.target"

/** What every step of one start needs. */
type StartCall = { args: StartInput; ctx: ToolContext; policy: Policy; name: string; role: Role }

/**
 * Starts a run under a role, or continues one, and returns once the brief is
 * admitted. What the arguments and the settings decide is checked before a
 * service is contacted; then the role is resolved, the session is created (or
 * set up again), read back and checked against what was set up, looked
 * at for another start's mark, given the operating note and sent the brief.
 * Until the brief is sent, a start that gives up takes back what it did: a
 * session it created is removed, one it continued is unmarked.
 */
export async function startRun(args: StartInput, ctx: ToolContext, policy: Policy): Promise<StartOutput> {
  const deadline = startDeadline(ctx)
  const { name, role } = checkStart(args, policy, ctx)
  const call: StartCall = { args, ctx, policy, name, role }
  const { session: sessionID } = args
  if (sessionID === undefined) {
    const target = await newTarget(args, ctx, policy, deadline)
    return withService(ctx, (service) => proceed(service, target, call), { deadline })
  }
  return withService(
    ctx,
    async (service) => proceed(service, await continuedTarget(service, sessionID, ctx, policy), call),
    { deadline },
  )
}

/** The steps of a start once the service is connected and the worktree is known. */
async function proceed(service: ServiceConnection, target: StartTarget, call: StartCall): Promise<StartOutput> {
  const { args, ctx, policy, name, role } = call
  const { worktree, directory, session } = target
  await loadLocation(service, directory, ctx)
  const resolved = await resolveStartRole(service, directory, name, role)
  await refuseBusy(service, { policy, worktree, session })

  const setup: SessionSetup = {
    agent: resolved.agent,
    model: modelOfStart(role, resolved.model, session),
    ruleset: await rulesetFor(service, policy, ctx),
    binding: bindingFor(ctx, name, worktree),
    directory,
  }
  const note = noteFor(policy, noteOf(ctx.options), role.note)

  let sessionID: string
  if (session === undefined) {
    sessionID = await createSession(service, setup)
  } else {
    await reconfigureSession(service, session, setup)
    sessionID = session.id
  }
  const takeBack = () =>
    session === undefined ? removeSession(service, sessionID) : unmarkSession(service, session, setup)

  let place: NotePlace
  try {
    await readBack(service, sessionID, setup, session !== undefined)
    await refuseRivalStart(service, directory, sessionID, runtimeOf(ctx).now())
    place = await placeNote(service, sessionID, note)
  } catch (error) {
    await takeBack()
    throw error
  }

  let state: StartState
  try {
    state = await sendBrief(service, sessionID, textOf(args.brief, note, place))
  } catch (error) {
    if (isToolError(error)) await takeBack()
    throw error
  }
  return {
    session: sessionID,
    new: session === undefined,
    role: name,
    agent: setup.agent,
    policy,
    model: modelText(setup.model),
    directory,
    branch: worktree.branch,
    state,
    note: place,
    service_started: service.started,
    ...(state === "unknown" && { message: UNCONFIRMED_ADMISSION }),
  }
}
