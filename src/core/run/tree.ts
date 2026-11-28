import { isToolError } from "../errors"
import type { ServiceConnection } from "../service/connect"
import { activeOf, sessionOf, type SessionEntry } from "../service/reply"

/** The most active sessions `activeSessions` reads: a person's service may run far more than a run needs looked at. */
export const MAX_ACTIVE_READ = 50
/** The most parents `inRun` follows from a session: deeper than a subagent chain goes. */
export const MAX_DEPTH = 8

/** The sessions the service is running now, each read with `session.get`; one that vanished meanwhile is left out. At most `MAX_ACTIVE_READ` are read. */
export async function activeSessions(service: ServiceConnection): Promise<SessionEntry[]> {
  const ids = [...activeOf(await service.client.session.active())].slice(0, MAX_ACTIVE_READ)
  const entries = await Promise.all(ids.map((sessionID) => sessionIfThere(service, sessionID)))
  return entries.filter((entry): entry is SessionEntry => entry !== undefined)
}

/** The session `sessionID`, or `undefined` when the service no longer has it. */
export async function sessionIfThere(service: ServiceConnection, sessionID: string): Promise<SessionEntry | undefined> {
  try {
    return sessionOf(await service.client.session.get({ sessionID }))
  } catch (error) {
    if (isToolError(error) && error.code === "not_found") return undefined
    throw error
  }
}

/**
 * Whether `entry` is the session `rootID` or a descendant of it, following
 * `parentID` through `lookup` for at most `MAX_DEPTH` hops. A parent `lookup`
 * cannot find, or a chain longer than that, is not in the run: a session that
 * cannot be traced to the run is not taken for part of it.
 */
export async function inRun(
  entry: SessionEntry,
  rootID: string,
  lookup: (id: string) => Promise<SessionEntry | undefined>,
): Promise<boolean> {
  let current = entry
  for (let hops = 0; ; hops += 1) {
    if (current.id === rootID) return true
    if (current.parentID === undefined || hops === MAX_DEPTH) return false
    const parent = await lookup(current.parentID)
    if (parent === undefined) return false
    current = parent
  }
}
