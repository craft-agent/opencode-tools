import { ToolError } from "../errors"
import { ownedSession } from "../run/owned"
import { MAX_RESULT } from "../run/read.schemas"
import { patchBudget } from "../run/read.changes"
import type { ServiceConnection } from "../service/connect"
import type { ToolContext } from "../tool"
import { REQUEST_NOT_PENDING, pendingOf } from "./pending"
import { pendingOut } from "./read.out"
import type { CallOf, RequestReadOutput } from "./read.schemas"

/** Method `get`: one request or question the run is paused on, with its text and its patches as far as their limits go. */
export async function readGet(
  checked: CallOf<"get">,
  service: ServiceConnection,
  ctx: ToolContext,
): Promise<RequestReadOutput> {
  const { session } = await ownedSession(service, checked.session, ctx.caller)
  const found = (await pendingOf(service, session, ctx)).find((request) => request.id === checked.request)
  if (found === undefined) throw new ToolError("not_found", REQUEST_NOT_PENDING)
  return {
    method: "get",
    service_started: service.started,
    session: session.id,
    request: pendingOut(found, { textLimit: MAX_RESULT, patches: patchBudget() }),
  }
}
