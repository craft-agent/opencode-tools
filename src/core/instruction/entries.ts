import { rosterOf } from "../run/roster"
import type { ServiceConnection } from "../service/connect"
import type { SessionEntry } from "../service/reply"
import { entriesOf, type InstructionEntry } from "../service/reply.instruction"
import { isPackageKey } from "./key"

/** When the agent is told of a change: at the run's next step while its own session is running, else at the head of its next turn. */
export const INSTRUCTION_WHEN = ["next_step", "next_turn"] as const

/** When the agent is told of a change. */
export type InstructionWhen = (typeof INSTRUCTION_WHEN)[number]

/** Every entry of the session, in the order the service lists them. */
export async function entriesOfSession(service: ServiceConnection, sessionID: string): Promise<InstructionEntry[]> {
  return entriesOf(await service.client.experimental.session.instructions.entry.list({ sessionID }))
}

/** The entries whose key starts with the package's prefix, whatever follows it. */
export function packageEntries(entries: readonly InstructionEntry[]): InstructionEntry[] {
  return entries.filter((entry) => isPackageKey(entry.key))
}

/** An entry's value as text: a text as it is, any other JSON as its JSON text, with `json` saying which. */
export function valueText(value: unknown): { text: string; json: boolean } {
  return typeof value === "string" ? { text: value, json: false } : { text: JSON.stringify(value), json: true }
}

/** When the agent of the session is told of a change made now, read from the service's active set. */
export async function whenTold(service: ServiceConnection, session: SessionEntry): Promise<InstructionWhen> {
  const roster = rosterOf(service, [session])
  await roster.refresh()
  return (await roster.membersOf(session.id)).includes(session.id) ? "next_step" : "next_turn"
}
