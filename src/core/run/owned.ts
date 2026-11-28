import { ToolError } from "../errors"
import type { ServiceConnection } from "../service/connect"
import { SESSION_NOT_FOUND } from "../service/errors"
import type { SessionEntry } from "../service/reply"
import { bindingOf, type Binding } from "./binding"
import { sessionIfThere } from "./tree"

/**
 * The run's own session `sessionID` and its binding. A session that does not
 * exist, one with no binding (a person's own), one bound to another caller and
 * a subagent's session all fail the same way, as `not_found`: a caller must
 * not be able to tell them apart.
 */
export async function ownedSession(
  service: ServiceConnection,
  sessionID: string,
  caller: string,
): Promise<{ session: SessionEntry; binding: Binding }> {
  const missing = () => new ToolError("not_found", SESSION_NOT_FOUND)
  const session = await sessionIfThere(service, sessionID)
  if (session === undefined) throw missing()
  const binding = bindingOf(session.metadata)
  if (binding === undefined || binding.caller !== caller || session.parentID !== undefined) throw missing()
  return { session, binding }
}
