import { isToolError } from "../errors"
import { sessionGone } from "../run/read.observe"
import { rosterOf } from "../run/roster"
import type { ServiceConnection } from "../service/connect"
import type { SessionEntry } from "../service/reply"
import {
  changedFilesOf,
  formDetailsOf,
  permissionRequestsOf,
  toolCallOf,
  type ChangedFile,
  type FieldEntry,
  type FormDetailEntry,
  type PermissionRequestEntry,
  type ToolCallEntry,
} from "../service/reply.request"
import type { ToolContext } from "../tool"
import { neverApproveOf } from "./options"
import { approvalTextOf } from "./text"
import { declineOnlyOf, rejectOnlyOf, type RejectOnly, type VerdictContext } from "./verdict"

/** What a request that is not pending in the run is told, whether it was answered, never existed or is another run's. */
export const REQUEST_NOT_PENDING = "The request is not pending in this run."

/** A permission request a run is paused on, whole. */
export type PendingPermission = {
  kind: "permission"
  id: string
  /** The session that asked: the run's own, or a subagent's. */
  session: string
  subagent: boolean
  agent?: string
  action: string
  resources: string[]
  /** The assistant message that holds the call; the service rejects every request of a step along with one. */
  step?: string
  tool?: string
  /** What an approval lets run, raw: neither cut nor cleaned. */
  text: string
  message?: string
  files?: ChangedFile[]
  rejectOnly?: RejectOnly
}

/** A question a run is paused on, whole. */
export type PendingQuestion = {
  kind: "question"
  id: string
  session: string
  subagent: boolean
  agent?: string
  title: string
  fields: FieldEntry[]
  declineOnly?: string
}

/** A request a run is paused on. */
export type Pending = PendingPermission | PendingQuestion

/** What one session of the run is paused on. */
type Asked = {
  session: string
  subagent: boolean
  agent?: string
  permissions: PermissionRequestEntry[]
  forms: FormDetailEntry[]
}

/**
 * What the session `entry` is paused on, with its agent; `undefined` for a
 * subagent's session the roster does not know or that has vanished. The run's
 * own that has is `not_found`.
 */
async function askedOf(
  service: ServiceConnection,
  entry: SessionEntry | undefined,
  own: boolean,
): Promise<Asked | undefined> {
  if (entry === undefined) return undefined
  const sessionID = entry.id
  try {
    const [permissions, forms] = await Promise.all([
      service.client.permission.list({ sessionID }).then(permissionRequestsOf),
      service.client.session.form.list({ sessionID }).then(formDetailsOf),
    ])
    return {
      session: sessionID,
      subagent: !own,
      ...(entry.agent !== undefined && { agent: entry.agent }),
      permissions,
      forms,
    }
  } catch (error) {
    if (!(isToolError(error) && error.code === "not_found")) throw error
    if (own) throw sessionGone()
    return undefined
  }
}

/** The assistant message `messageID` of `sessionID` as the service sent it; `undefined` when the service no longer has it. */
async function messageIfThere(service: ServiceConnection, sessionID: string, messageID: string): Promise<unknown> {
  try {
    return await service.client.session.message.get({ sessionID, messageID })
  } catch (error) {
    if (isToolError(error) && error.code === "not_found") return undefined
    throw error
  }
}

function permissionOf(
  asked: Asked,
  request: PermissionRequestEntry,
  call: ToolCallEntry | undefined,
  context: VerdictContext,
): PendingPermission {
  const text = approvalTextOf({ action: request.action, resources: request.resources, ...(call && { call }) })
  const files = changedFilesOf(request.metadata)
  const rejectOnly = rejectOnlyOf(
    { action: request.action, resources: request.resources, text, subagent: asked.subagent },
    context,
  )
  return {
    kind: "permission",
    id: request.id,
    session: asked.session,
    subagent: asked.subagent,
    ...(asked.agent !== undefined && { agent: asked.agent }),
    action: request.action,
    resources: request.resources,
    ...(request.source !== undefined && { step: request.source.messageID }),
    ...(call !== undefined && { tool: call.tool }),
    text,
    ...(request.message !== undefined && { message: request.message }),
    ...(files !== undefined && { files }),
    ...(rejectOnly !== undefined && { rejectOnly }),
  }
}

function questionOf(asked: Asked, form: FormDetailEntry): PendingQuestion {
  const declineOnly = declineOnlyOf(form.fields)
  return {
    kind: "question",
    id: form.id,
    session: asked.session,
    subagent: asked.subagent,
    ...(asked.agent !== undefined && { agent: asked.agent }),
    title: form.title,
    fields: form.fields,
    ...(declineOnly !== undefined && { declineOnly }),
  }
}

/**
 * Everything the run is paused on: the requests and questions of its own
 * session, then of each of its sessions the service is running, each in the
 * service's order. A request's call is read from the messages of the session
 * that asked, once for each message; a call that cannot be read leaves the
 * request with its resources as its text.
 */
export async function pendingOf(
  service: ServiceConnection,
  root: SessionEntry,
  ctx: Pick<ToolContext, "options">,
): Promise<Pending[]> {
  const context: VerdictContext = { neverApprove: neverApproveOf(ctx.options), rules: root.permissions ?? [] }
  const roster = rosterOf(service, [root])
  await roster.refresh()
  const members = await roster.membersOf(root.id)
  const sessions = [...new Set([root.id, ...members])]
  const asked = (
    await Promise.all(
      sessions.map((id) => askedOf(service, id === root.id ? root : roster.entryOf(id), id === root.id)),
    )
  ).filter((entry) => entry !== undefined)

  const messages = new Map<string, Promise<unknown>>()
  const messageOf = (sessionID: string, messageID: string): Promise<unknown> => {
    const key = JSON.stringify([sessionID, messageID])
    const known = messages.get(key) ?? messageIfThere(service, sessionID, messageID)
    messages.set(key, known)
    return known
  }
  const callOf = async (entry: Asked, request: PermissionRequestEntry) =>
    request.source === undefined
      ? undefined
      : toolCallOf(await messageOf(entry.session, request.source.messageID), request.source.id)

  const pending = await Promise.all(
    asked.map(async (entry) => [
      ...(await Promise.all(
        entry.permissions.map(async (request) => permissionOf(entry, request, await callOf(entry, request), context)),
      )),
      ...entry.forms.map((form) => questionOf(entry, form)),
    ]),
  )
  return pending.flat()
}
