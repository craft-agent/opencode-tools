import type { ServiceConnection } from "../service/connect"
import { activeOf, type SessionEntry } from "../service/reply"
import { MAX_ACTIVE_READ, inRun, sessionIfThere } from "./tree"

/** What the service is running now, and which runs it belongs to. */
export type Roster = {
  /** Reads the service's active set again; the sessions it lists that were read before are not read again, since a session's parent never changes. */
  refresh(): Promise<void>
  /** The ids of the sessions of the run `rootID` that are in the active set, the root itself first when it is: the run's active members. */
  membersOf(rootID: string): Promise<string[]>
}

/**
 * A roster over the service, for one call. It keeps the sessions it read, and
 * the `seen` ones it is given, so that a wait polling the active set reads
 * each session once, not once per poll. At most `MAX_ACTIVE_READ` sessions of
 * the active set are looked at, as `activeSessions` does.
 */
export function rosterOf(service: ServiceConnection, seen: readonly SessionEntry[] = []): Roster {
  const known = new Map<string, SessionEntry>(seen.map((entry) => [entry.id, entry]))
  let active = new Set<string>()
  let looked: string[] = []
  const lookup = async (id: string): Promise<SessionEntry | undefined> => {
    const cached = known.get(id)
    if (cached !== undefined) return cached
    const entry = await sessionIfThere(service, id)
    if (entry !== undefined) known.set(id, entry)
    return entry
  }
  return {
    async refresh() {
      active = activeOf(await service.client.session.active())
      looked = [...active].slice(0, MAX_ACTIVE_READ)
      await Promise.all(looked.map(lookup))
    },
    async membersOf(rootID) {
      const members = active.has(rootID) ? [rootID] : []
      for (const id of looked) {
        const entry = known.get(id)
        if (id !== rootID && entry !== undefined && (await inRun(entry, rootID, lookup))) members.push(id)
      }
      return members
    },
  }
}
