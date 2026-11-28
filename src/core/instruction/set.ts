import { ToolError } from "../errors"
import { ownedSession } from "../run/owned"
import type { ServiceConnection } from "../service/connect"
import type { InstructionEntry } from "../service/reply.instruction"
import type { ToolContext } from "../tool"
import { entriesOfSession, packageEntries, whenTold } from "./entries"
import { checkKey } from "./key"
import { MAX_ENTRIES } from "./limits"
import type { SetInput, SetOutput } from "./set.schemas"

/**
 * Checks what the arguments alone decide, so that a mistake starts no service
 * and sends no request: the key's form, and a value that is not blank.
 */
export function checkSet(args: SetInput): void {
  checkKey(args.key, "write")
  if (args.value.trim() === "") throw new ToolError("invalid_argument", "value must not be blank.")
}

/** Refuses a key that is not there yet when the session already holds `MAX_ENTRIES` entries of the package. */
export function requireRoom(entries: readonly InstructionEntry[], key: string): void {
  if (entries.some((entry) => entry.key === key) || packageEntries(entries).length < MAX_ENTRIES) return
  throw new ToolError(
    "invalid_argument",
    `The session already holds ${MAX_ENTRIES} entries of the package; remove one before adding ${key}.`,
    { details: { reason: "too_many" } },
  )
}

/**
 * Puts the value under the key on the run's own session and says when the
 * agent is told. A key that already holds this text sends nothing, since the
 * service tells the agent nothing then either.
 */
export async function setEntry(service: ServiceConnection, args: SetInput, ctx: ToolContext): Promise<SetOutput> {
  checkSet(args)
  const { session } = await ownedSession(service, args.session, ctx.caller)
  const entries = await entriesOfSession(service, session.id)
  const held = entries.find((entry) => entry.key === args.key)
  const base = { service_started: service.started, session: session.id, key: args.key }
  if (held !== undefined && held.value === args.value) return { ...base, changed: false, replaced: false }
  requireRoom(entries, args.key)
  await service.client.experimental.session.instructions.entry.put({
    sessionID: session.id,
    key: args.key,
    value: args.value,
  })
  return { ...base, changed: true, replaced: held !== undefined, when: await whenTold(service, session) }
}
