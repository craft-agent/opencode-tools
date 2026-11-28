import { ToolError } from "../errors"
import { ownedSession } from "../run/owned"
import type { ServiceConnection } from "../service/connect"
import type { ToolContext } from "../tool"
import { entriesOfSession } from "./entries"
import { MAX_ENTRY_READ } from "./limits"
import { entryOut } from "./read.out"
import type { CallOf, InstructionReadOutput } from "./read.schemas"

/** Method `get`: one entry whole, its value cut only at `MAX_ENTRY_READ`; a key that is not there is `not_found`. */
export async function readGet(
  checked: CallOf<"get">,
  service: ServiceConnection,
  ctx: Pick<ToolContext, "caller">,
): Promise<InstructionReadOutput> {
  const { session } = await ownedSession(service, checked.session, ctx.caller)
  const found = (await entriesOfSession(service, session.id)).find((entry) => entry.key === checked.key)
  if (found === undefined) {
    throw new ToolError("not_found", `The session holds no entry ${checked.key}.`)
  }
  return {
    method: "get",
    service_started: service.started,
    session: session.id,
    entry: entryOut(found, MAX_ENTRY_READ),
  }
}
