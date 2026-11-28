import { z } from "zod"
import { MAX_ID } from "../service/schemas"
import { MAX_BRIEF } from "./start.schemas"
import { runSummaryFields } from "./summary"

/** When a run reads a steer: already, at its next step, or once the request its own session is paused on is answered. */
export const STEER_WHEN = ["read", "next_step", "after_request"] as const

/** When a run reads a steer. */
export type SteerWhen = (typeof STEER_WHEN)[number]

/** The arguments of `opencode_run_steer`. */
export const steerInput = z.object({
  session: z.string().min(1).max(MAX_ID).describe("The id of a session a start returned."),
  message: z
    .string()
    .min(1)
    .max(MAX_BRIEF)
    .describe(`The correction for the turn in flight: 1 to ${MAX_BRIEF} characters, not blank.`),
})

/** The result of `opencode_run_steer`. */
export const steerOutput = z.object({
  service_started: z.boolean().describe("True when this call found no service running and started one."),
  session: z.string().describe("The run's session."),
  when: z
    .enum(STEER_WHEN)
    .describe(
      "`read`: the run has read the message. `next_step`: it reads it at its next step. `after_request`: its own session is paused on a request, and reads it once that is answered.",
    ),
  ...runSummaryFields("after the message was sent"),
})

/** The arguments of a call of `opencode_run_steer`. */
export type SteerInput = z.output<typeof steerInput>
/** The result of a call of `opencode_run_steer`. */
export type SteerOutput = z.input<typeof steerOutput>
