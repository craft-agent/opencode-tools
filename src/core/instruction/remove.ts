import { ownedSession } from "../run/owned"
import type { ServiceConnection } from "../service/connect"
import type { ToolContext } from "../tool"
import { entriesOfSession, whenTold } from "./entries"
import { checkKey } from "./key"
import type { RemoveInput, RemoveOutput } from "./remove.schemas"

/**
 * Removes the entry from the run's own session and says when the agent is
 * told. A key that is not there sends nothing: there is nothing to remove.
 */
export async function removeEntry(
  service: ServiceConnection,
  args: RemoveInput,
  ctx: ToolContext,
): Promise<RemoveOutput> {
  checkKey(args.key, "write")
  const { session } = await ownedSession(service, args.session, ctx.caller)
  const base = { service_started: service.started, session: session.id, key: args.key }
  if (!(await entriesOfSession(service, session.id)).some((entry) => entry.key === args.key)) {
    return { ...base, removed: false }
  }
  await service.client.experimental.session.instructions.entry.remove({ sessionID: session.id, key: args.key })
  return { ...base, removed: true, when: await whenTold(service, session) }
}
