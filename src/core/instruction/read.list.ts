import { ownedSession } from "../run/owned"
import type { ServiceConnection } from "../service/connect"
import type { ToolContext } from "../tool"
import { entriesOfSession, packageEntries } from "./entries"
import { MAX_ENTRIES_LISTED, MAX_LISTED_VALUE } from "./limits"
import { entryOut } from "./read.out"
import type { CallOf, InstructionReadOutput } from "./read.schemas"

/** Method `list`: the package's entries of the run's session, each cut to a size, and how many entries sit under other keys. */
export async function readList(
  checked: CallOf<"list">,
  service: ServiceConnection,
  ctx: Pick<ToolContext, "caller">,
): Promise<InstructionReadOutput> {
  const { session } = await ownedSession(service, checked.session, ctx.caller)
  const all = await entriesOfSession(service, session.id)
  const ours = packageEntries(all)
  const cut = ours.length > MAX_ENTRIES_LISTED
  return {
    method: "list",
    service_started: service.started,
    session: session.id,
    entries: ours.slice(0, MAX_ENTRIES_LISTED).map((entry) => entryOut(entry, MAX_LISTED_VALUE)),
    ...(cut && { total: ours.length, truncated: true as const }),
    others: all.length - ours.length,
  }
}
