import { runtimeOf } from "../runtime"
import type { ServiceConnection } from "../service/connect"
import type { RetryEntry } from "../service/reply.run"
import type { ToolContext } from "../tool"
import { ownedSession } from "./owned"
import { describeRun } from "./read.get"
import { observeRun, type Observation } from "./read.observe"
import { handsBack, pickRetry, readRetries } from "./read.retry"
import type { CallOf, RunReadOutput } from "./read.schemas"
import { rosterOf } from "./roster"

/** How long a wait leaves between two looks at the service, on the runtime's clock. */
export const WAIT_POLL_MS = 1000
/** What a wait leaves of the call's time for what it reads after the last look: the run's reply, and a retry. */
export const WAIT_RESERVE_MS = 3000
/** How many looks a wait takes between two reads of the run's retry, which costs a request for each session of the run that is active. */
export const RETRY_POLL_EVERY = 5

/**
 * Method `wait`: looks at the run at intervals and returns as `get` does once
 * its state is no longer `running`, or once it keeps retrying its provider
 * (`handsBack`), or when the call has no more than `WAIT_RESERVE_MS` left, with
 * `timed_out`. A look reads only what the state needs: the active set, which
 * each session is read for once, and what the active sessions are paused on.
 * The reply is read once, at the end. What the wait learned is kept for this
 * call alone.
 */
export async function readWait(
  checked: CallOf<"wait">,
  service: ServiceConnection,
  ctx: ToolContext,
): Promise<RunReadOutput> {
  const { session, binding } = await ownedSession(service, checked.session, ctx.caller)
  const rt = runtimeOf(ctx)
  const roster = rosterOf(service, [session])

  let observed: Observation | undefined
  let handedBack: RetryEntry | undefined
  let timedOut = false
  for (let look = 0; ; look += 1) {
    await roster.refresh()
    observed = await observeRun(service, roster, observed?.root ?? session, ctx, {
      rootFresh: look === 0,
      readIdleRoot: true,
    })
    if (observed.state.state !== "running") break
    if (look % RETRY_POLL_EVERY === 0) {
      const retry = pickRetry(await readRetries(service, session.id, observed.members))
      if (retry !== undefined && handsBack(retry)) {
        handedBack = retry
        break
      }
    }
    const leftMs = service.deadline.remaining() - WAIT_RESERVE_MS
    if (leftMs <= 0) {
      timedOut = true
      break
    }
    await rt.sleep(Math.min(WAIT_POLL_MS, leftMs), ctx.signal)
  }
  return { ...(await describeRun(service, "wait", binding, observed, handedBack)), timed_out: timedOut }
}
