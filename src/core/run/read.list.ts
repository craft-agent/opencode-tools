import { isToolError } from "../errors"
import type { ServiceConnection } from "../service/connect"
import { idFits, listed } from "../service/listing"
import { sessionPageOf, type SessionEntry } from "../service/reply"
import { MAX_LISTED } from "../service/schemas"
import type { ToolContext } from "../tool"
import { bindingOf, type Binding } from "./binding"
import { observeRun } from "./read.observe"
import { LIST_PAGE_SIZE, MAX_LIST_PAGES, MAX_RUN_NAME, type CallOf, type RunReadOutput } from "./read.schemas"
import { lineOf } from "./read.text"
import { rosterOf } from "./roster"

type Run = { session: SessionEntry; binding: Binding }

/**
 * The caller's runs among the service's top-level sessions, as the service
 * lists them, for at most `MAX_LIST_PAGES` pages; `more` says the service held
 * more than that.
 */
async function callerRuns(
  checked: CallOf<"list">,
  service: ServiceConnection,
  ctx: ToolContext,
): Promise<{ runs: Run[]; more: boolean }> {
  const runs: Run[] = []
  let cursor: string | undefined
  let pages = 0
  do {
    const page = sessionPageOf(
      await service.client.session.list({
        parentID: null,
        limit: LIST_PAGE_SIZE,
        ...(checked.directory !== undefined && { directory: checked.directory }),
        ...(cursor !== undefined && { cursor }),
      }),
    )
    pages += 1
    for (const session of page.sessions) {
      const binding = bindingOf(session.metadata)
      const wanted = checked.directory === undefined || session.directory === checked.directory
      if (session.parentID === undefined && binding?.caller === ctx.caller && wanted) runs.push({ session, binding })
    }
    cursor = page.next
  } while (cursor !== undefined && pages < MAX_LIST_PAGES)
  return { runs, more: cursor !== undefined }
}

/** Method `list`: the caller's runs, newest update first, each with the state it is in. */
export async function readList(
  checked: CallOf<"list">,
  service: ServiceConnection,
  ctx: ToolContext,
): Promise<RunReadOutput> {
  const { runs, more } = await callerRuns(checked, service, ctx)
  runs.sort((a, b) => b.session.time.updated - a.session.time.updated)
  const usable = runs.filter((run) => idFits(run.session.id))
  // The limiter keeps at most MAX_LISTED, so no state is read for a run past it.
  const shown = usable.slice(0, MAX_LISTED)

  const roster = rosterOf(
    service,
    shown.map((run) => run.session),
  )
  await roster.refresh()
  const entries = []
  for (const { session, binding } of shown) {
    try {
      const { state } = await observeRun(service, roster, session, ctx, { rootFresh: true, readIdleRoot: false })
      const title = session.title === undefined ? "" : lineOf(session.title, MAX_RUN_NAME)
      entries.push({
        session: session.id,
        ...(title !== "" && { title }),
        ...(session.forkedFrom !== undefined && { forked_from: session.forkedFrom }),
        role: binding.role,
        directory: session.directory,
        branch: binding.branch,
        state: state.state,
      })
    } catch (error) {
      // A run removed while the list was read is no longer a run.
      if (!(isToolError(error) && error.code === "not_found")) throw error
    }
  }
  const { kept, truncated } = listed(entries)
  return {
    method: "list",
    service_started: service.started,
    runs: kept,
    total: runs.length,
    truncated: truncated || shown.length < runs.length,
    ...(more && { more }),
  }
}
