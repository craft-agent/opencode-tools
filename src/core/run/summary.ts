import { z } from "zod"
import { isAbortError, isToolError } from "../errors"
import type { ServiceConnection } from "../service/connect"
import { cleaned } from "../service/errors"
import type { SessionEntry } from "../service/reply"
import type { ToolContext } from "../tool"
import type { Binding } from "./binding"
import { describeRun } from "./read.get"
import { observeRun, type Observation } from "./read.observe"
import { runStateOutput } from "./read.schemas"
import { rosterOf } from "./roster"

const runError = z.object({ code: z.string(), message: z.string() })

/** Why a run could not be read: an error's code and message. */
export type RunError = z.output<typeof runError>

/** The run as a call that changed it leaves it, as `get` gives it, or why it could not be read. */
export type RunSummary = { run: z.input<typeof runStateOutput> } | { run_error: RunError }

/** The fields of a result that carry a `RunSummary`, `after` saying when: "after the message was sent". */
export function runSummaryFields(after: string) {
  return {
    run: runStateOutput
      .optional()
      .describe(
        `The run ${after}, as \`opencode_run_read\` method \`get\` gives it. Present unless \`run_error\` is: exactly one of the two.`,
      ),
    run_error: runError
      .optional()
      .describe(
        `Present, instead of \`run\`, when the run could not be read ${after}: the error code and message. \`opencode_run_read\` reads the run.`,
      ),
  }
}

/**
 * Describes the run as `get` does, minus what the call says itself (`method`,
 * `service_started`, `session`), from what `observe` finds. The call has
 * changed the run by then, so a failure to read it is the result's `run_error`,
 * never the call's; a cancellation is rethrown.
 */
export async function summarizeRun(
  service: ServiceConnection,
  binding: Binding,
  ctx: Pick<ToolContext, "signal">,
  observe: () => Promise<Observation>,
): Promise<RunSummary> {
  try {
    const {
      method: _method,
      service_started: _started,
      session: _session,
      ...run
    } = await describeRun(service, "get", binding, await observe())
    return { run }
  } catch (error) {
    if (isAbortError(error) || ctx.signal?.aborted || !isToolError(error)) throw error
    return { run_error: { code: error.code, message: cleaned(error.message) } }
  }
}

/**
 * One look at the run as it is now: the service's active set read again, and
 * the run's own session read again unless it is active, since a call that
 * changed the run read it before.
 */
export async function lookAtRun(
  service: ServiceConnection,
  session: SessionEntry,
  ctx: Pick<ToolContext, "runtime">,
): Promise<Observation> {
  const roster = rosterOf(service, [session])
  await roster.refresh()
  return observeRun(service, roster, session, ctx, { rootFresh: false, readIdleRoot: true })
}
