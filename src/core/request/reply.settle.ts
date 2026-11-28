import { isAbortError, isToolError } from "../errors"
import type { Binding } from "../run/binding"
import { describeRun } from "../run/read.get"
import { observeRun } from "../run/read.observe"
import { WAIT_POLL_MS, WAIT_RESERVE_MS } from "../run/read.wait"
import { rosterOf } from "../run/roster"
import { runtimeOf } from "../runtime"
import type { ServiceConnection } from "../service/connect"
import { cleaned } from "../service/errors"
import type { SessionEntry } from "../service/reply"
import type { ToolContext } from "../tool"
import type { RequestReplyOutput } from "./reply.schemas"

/** How long a call that sent a reply waits for the run to pause again or end, on the runtime's clock. */
export const SETTLE_MS = 10_000

/**
 * The run as the call leaves it, or why it could not be read, and the ids of
 * the requests the first look found it paused on; none when that look failed.
 */
export type Settled = { firstPending?: ReadonlySet<string> } & (
  { run: NonNullable<RequestReplyOutput["run"]> } | { run_error: NonNullable<RequestReplyOutput["run_error"]> }
)

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

  let firstPending: ReadonlySet<string> | undefined
  try {
    const first = await look(session)
    firstPending = new Set(first.requests.map((request) => request.id))
    let observed = first
    while (sent && observed.state.state === "running") {
      const leftMs = Math.min(endsAt - rt.now(), service.deadline.remaining() - WAIT_RESERVE_MS)
      if (leftMs <= 0) break
      await rt.sleep(Math.min(WAIT_POLL_MS, leftMs), ctx.signal)
      observed = await look(observed.root)
    }
    const {
      method: _method,
      service_started: _started,
      session: _session,
      ...run
    } = await describeRun(service, "get", binding, observed)
    return { run, firstPending }
  } catch (error) {
    if (isAbortError(error) || ctx.signal?.aborted || !isToolError(error)) throw error
    return {
      run_error: { code: error.code, message: cleaned(error.message) },
      ...(firstPending !== undefined && { firstPending }),
    }
  }
}
