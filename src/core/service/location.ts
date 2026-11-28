import { ToolError } from "../errors"
import { runtimeOf } from "../runtime"
import { shown } from "../text"
import type { ToolContext } from "../tool"
import type { ServiceConnection } from "./connect"
import { MAX_SHOWN_DIRECTORY } from "./directory"
import { pluginsOf } from "./reply"

/** How long a directory the service has not opened may take to load: a fraction of a second in a running service, a few seconds in one that has just started. */
export const LOCATION_TIMEOUT_MS = 15_000
/** How often it is looked at meanwhile. */
export const LOCATION_POLL_MS = 50
/** How long a loaded directory's version control may take to show; the call goes on without a branch after that. */
export const BRANCH_TIMEOUT_MS = 1_000

const MS_PER_SECOND = 1000

/**
 * Waits until the service has loaded a directory. The service answers at once
 * for a directory it has not opened, with nothing in it, and loads its
 * plugins in the background: its agents, providers and models are right only
 * once `plugin.list` has entries, which is how OpenCode's own command line
 * waits. Going on with a directory that did not load would answer with an
 * empty result taken for a real one, so past `LOCATION_TIMEOUT_MS` this fails.
 */
export async function loadLocation(
  service: ServiceConnection,
  directory: string,
  ctx: Pick<ToolContext, "signal" | "runtime">,
): Promise<void> {
  const rt = runtimeOf(ctx)
  const deadline = rt.now() + LOCATION_TIMEOUT_MS
  const location = { location: { directory } }
  for (;;) {
    if (pluginsOf(await service.client.plugin.list(location)).length > 0) return
    if (rt.now() >= deadline) {
      throw new ToolError(
        "upstream_error",
        `The OpenCode service did not finish loading ${shown(directory, MAX_SHOWN_DIRECTORY)} within ${LOCATION_TIMEOUT_MS / MS_PER_SECOND} seconds; try again.`,
      )
    }
    await rt.sleep(LOCATION_POLL_MS, ctx.signal)
  }
}
