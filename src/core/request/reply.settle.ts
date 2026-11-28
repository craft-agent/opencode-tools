import type { Binding } from "../run/binding"
import { observeRun } from "../run/read.observe"
import { WAIT_POLL_MS, WAIT_RESERVE_MS } from "../run/read.wait"
import { rosterOf } from "../run/roster"
import { summarizeRun, type RunSummary } from "../run/summary"
import { runtimeOf } from "../runtime"
import type { ServiceConnection } from "../service/connect"
import type { SessionEntry } from "../service/reply"
import type { ToolContext } from "../tool"

/** How long a call that sent a reply waits for the run to pause again or end, on the runtime's clock. */
export const SETTLE_MS = 10_000

/**
 * The run as the call leaves it, or why it could not be read, and the ids of
 * the requests the first look found it paused on; none when that look failed.
 */
export type Settled = { firstPending?: ReadonlySet<string> } & RunSummary

/**
 * Looks at the run after the replies: once when none was sent, else at
 * intervals of `WAIT_POLL_MS` until its state is no longer `running`, for
 * `SETTLE_MS` at most and never into the `WAIT_RESERVE_MS` the call keeps for
 * reading the result. The run's own session was read before the replies, so
 * no look takes it as fresh. The replies have been sent by then, so a failure
 * to read the run is the result's `run_error`, never the call's; a
 * cancellation is rethrown.
 */
export async function settleRun(
  service: ServiceConnection,
  session: SessionEntry,
  binding: Binding,
  sent: boolean,
  ctx: Pick<ToolContext, "runtime" | "signal">,
): Promise<Settled> {
  const rt = runtimeOf(ctx)
  const roster = rosterOf(service, [session])
  const endsAt = rt.now() + SETTLE_MS
  const look = async (root: SessionEntry) => {
    await roster.refresh()
    return observeRun(service, roster, root, ctx, { rootFresh: false, readIdleRoot: true })
  }

  const seen: { firstPending?: ReadonlySet<string> } = {}
  const summary = await summarizeRun(service, binding, ctx, async () => {
    const first = await look(session)
    seen.firstPending = new Set(first.requests.map((request) => request.id))
    let observed = first
    while (sent && observed.state.state === "running") {
      const leftMs = Math.min(endsAt - rt.now(), service.deadline.remaining() - WAIT_RESERVE_MS)
      if (leftMs <= 0) break
      await rt.sleep(Math.min(WAIT_POLL_MS, leftMs), ctx.signal)
      observed = await look(observed.root)
    }
    return observed
  })
  return { ...summary, ...seen }
}
