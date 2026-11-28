import { ToolError } from "./errors"
import { runtimeOf } from "./runtime"
import type { ToolContext, ToolOptions } from "./tool"

const MS_PER_SECOND = 1000

/** The setting that limits a whole call, in seconds. */
export const WAIT_SECONDS_OPTION = "wait_seconds"
/** The limit of a call when the setting is unset: under a harness that ends a tool call after a minute. */
export const DEFAULT_WAIT_SECONDS = 50
/** The least the setting may be. */
export const MIN_WAIT_SECONDS = 1
/** The most the setting may be: under an hour, where a harness's own longest limit on a call sits. */
export const MAX_WAIT_SECONDS = 3300

export type Deadline = {
  /** The seconds the call was given. */
  readonly seconds: number
  /** The milliseconds left, never below zero. */
  remaining(): number
  /** The smaller of `ms` and what is left. */
  within(ms: number): number
  /** The error of a call that ran out while `waitingFor`, e.g. "the OpenCode service to start". */
  ended(waitingFor: string): ToolError
}

/** The limit of a whole call in seconds: the `wait_seconds` option when it is a number, else `DEFAULT_WAIT_SECONDS`. Its bounds are the settings layer's to check. */
export function waitSecondsOf(options: ToolOptions | undefined): number {
  const value = options?.[WAIT_SECONDS_OPTION]
  return typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_WAIT_SECONDS
}

/** Starts the call's clock: `waitSecondsOf(ctx.options)` seconds from now, on the call's runtime clock. */
export function startDeadline(ctx: Pick<ToolContext, "options" | "runtime">): Deadline {
  const rt = runtimeOf(ctx)
  const seconds = waitSecondsOf(ctx.options)
  const endsAt = rt.now() + seconds * MS_PER_SECOND
  const remaining = () => Math.max(0, endsAt - rt.now())
  return {
    seconds,
    remaining,
    within: (ms) => Math.min(ms, remaining()),
    ended: (waitingFor) =>
      new ToolError(
        "upstream_error",
        `The call's time of ${seconds} ${seconds === 1 ? "second" : "seconds"} ended while it waited for ${waitingFor}.`,
      ),
  }
}
