import { ToolError } from "../errors"
import { realOrGiven } from "../paths"
import type { Policy } from "../role"
import type { ServiceConnection } from "../service/connect"
import { MAX_SHOWN_DIRECTORY } from "../service/directory"
import { cleaned } from "../service/errors"
import { sessionsOf, type SessionEntry } from "../service/reply"
import { shown } from "../text"
import { bindingOf, isStarting } from "./binding"
import { activeSessions, inRun, sessionIfThere } from "./tree"
import type { Worktree } from "./worktree"

/** The most sessions of a directory a start looks at for another start's mark. */
export const MAX_RIVAL_LISTED = 100

/** What a start is about to set up, as far as what is running decides it. */
export type BusyCheck = {
  policy: Policy
  worktree: Worktree
  /** The session a start continues; absent for a new one. */
  session?: SessionEntry
}

/**
 * Refuses a start the service's running sessions rule out: a continued
 * session that is running (itself or a subagent of it), and for a write run
 * another session running in its worktree, whoever it belongs to. A new
 * read-only run asks the service nothing.
 */
export async function refuseBusy(service: ServiceConnection, check: BusyCheck): Promise<void> {
  const { policy, worktree, session } = check
  if (session === undefined && policy === "read-only") return
  const active = await activeSessions(service)
  const known = new Map(active.map((entry) => [entry.id, entry]))
  const lookup = async (id: string) => known.get(id) ?? (await sessionIfThere(service, id))

  const others: SessionEntry[] = []
  for (const entry of active) {
    if (session !== undefined && (await inRun(entry, session.id, lookup))) {
      throw new ToolError("invalid_argument", `Session ${cleaned(session.id)} is running; a start needs it idle.`, {
        details: { reason: "running" },
      })
    }
    others.push(entry)
  }
  if (policy === "write") {
    for (const entry of others) {
      if ((await realOrGiven(entry.directory)) === worktree.directory) {
        throw new ToolError(
          "invalid_argument",
          `Another session is running in ${shown(worktree.directory, MAX_SHOWN_DIRECTORY)}; a write run starts when it has finished.`,
          { details: { reason: "worktree_busy" } },
        )
      }
    }
  }
}

/**
 * Refuses a start that finds another call's mark on a session of its
 * directory: a session other than `ownID` that is being set up now. Every
 * start looks after it has marked its own session, so of two starts at once at
 * least one sees the other.
 */
export async function refuseRivalStart(
  service: ServiceConnection,
  directory: string,
  ownID: string,
  now: number,
): Promise<void> {
  const listed = sessionsOf(await service.client.session.list({ directory, parentID: null, limit: MAX_RIVAL_LISTED }))
  const rival = listed.find((entry) => entry.id !== ownID && isStarting(bindingOf(entry.metadata), entry.time, now))
  if (rival !== undefined) {
    throw new ToolError(
      "stale",
      `Another call is starting a run in ${shown(directory, MAX_SHOWN_DIRECTORY)}; try again in a moment.`,
    )
  }
}
