import { ToolError, isToolError } from "../errors"
import { runtimeOf } from "../runtime"
import type { ServiceConnection } from "../service/connect"
import { SESSION_NOT_FOUND } from "../service/errors"
import type { SessionEntry } from "../service/reply"
import { formsOf, newestInboxOf, permissionsOf } from "../service/reply.run"
import type { ToolContext } from "../tool"
import type { Roster } from "./roster"
import { needsInbox, runState, type StateResult } from "./state"
import { sessionIfThere } from "./tree"

/**
 * The type of an inbox item that is a prompt. In a session that was never
 * busy only a prompt is the sign of a turn about to begin: a fork holds what
 * waited unread in its source's inbox, copied as items made at the fork, and
 * a report among them starts nothing.
 */
const PROMPT_ITEM = "user"

/** A request a run is paused on, as the service lists it. */
export type PendingRequest =
  | { kind: "permission"; id: string; session: string; action: string; resources: string[] }
  | { kind: "question"; id: string; session: string; title: string }

/** What one look at a run found: what its state is read from, and the state. */
export type Observation = {
  /** The run's own session, as read last. */
  root: SessionEntry
  /** Whether `root` was read by this look, or handed to it as just read; a look that finds a subagent running leaves it as it was. */
  fresh: boolean
  state: StateResult
  /** The ids of the run's sessions in the active set, the run's own first when it is. */
  members: string[]
  /** Every request the run is paused on, those of the run's own session first. */
  requests: PendingRequest[]
}

export type ObserveOptions = {
  /** Whether `root` was read just now, so that a look which finds the run idle need not read it again. */
  rootFresh: boolean
  /** Whether a run with nothing active is asked for its own session's requests: a session that is paused is active, so a list leaves it out. */
  readIdleRoot: boolean
}

/** The error of a session the service no longer has, worded as for one that never existed. */
export function sessionGone(): ToolError {
  return new ToolError("not_found", SESSION_NOT_FOUND)
}

/** Runs `read`, and answers `empty` when the service no longer has the session. */
async function unlessGone<T>(read: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await read()
  } catch (error) {
    if (isToolError(error) && error.code === "not_found") return empty
    throw error
  }
}

/** The requests `sessionID` is paused on; a subagent's session that has vanished has none, the run's own is `not_found`. */
async function requestsOf(service: ServiceConnection, sessionID: string, own: boolean): Promise<PendingRequest[]> {
  const read = async (): Promise<PendingRequest[]> => {
    const [permissions, forms] = await Promise.all([
      service.client.permission.list({ sessionID }).then(permissionsOf),
      service.client.session.form.list({ sessionID }).then(formsOf),
    ])
    return [
      ...permissions.map((request): PendingRequest => ({
        kind: "permission",
        id: request.id,
        session: sessionID,
        action: request.action,
        resources: request.resources,
      })),
      ...forms.map((form): PendingRequest => ({
        kind: "question",
        id: form.id,
        session: sessionID,
        title: form.title,
      })),
    ]
  }
  return own ? read() : unlessGone(read, [])
}

/**
 * Looks at a run: which of its sessions the service is running (the roster
 * must have been refreshed), what each of them is paused on, and, only where
 * nothing else settles the state, its own session's inbox. The run's own
 * session is read again only when nothing of the run is active and it was not
 * read just now.
 */
export async function observeRun(
  service: ServiceConnection,
  roster: Roster,
  root: SessionEntry,
  ctx: Pick<ToolContext, "runtime">,
  options: ObserveOptions,
): Promise<Observation> {
  const members = await roster.membersOf(root.id)
  const active = members.length > 0
  let current = root
  let fresh = options.rootFresh
  if (!active && !fresh) {
    const reread = await sessionIfThere(service, root.id)
    if (reread === undefined) throw sessionGone()
    current = reread
    fresh = true
  }

  const asked = active || options.readIdleRoot ? [...new Set([root.id, ...members])] : []
  const requests = (await Promise.all(asked.map((id) => requestsOf(service, id, id === root.id)))).flat()
  const waiting = requests.length > 0

  const facts = { session: current, waiting, active }
  const inboxCreated = needsInbox(facts)
    ? newestInboxOf(
        await service.client.session.inbox.list({ sessionID: root.id }),
        current.time.busy === undefined ? PROMPT_ITEM : undefined,
      )
    : undefined
  const state = runState({
    ...facts,
    now: runtimeOf(ctx).now(),
    ...(inboxCreated !== undefined && { inboxCreated }),
  })
  return { root: current, fresh, state, members, requests }
}
