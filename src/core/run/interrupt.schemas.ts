import { z } from "zod"
import { MAX_ID } from "../service/schemas"
import { runSummaryFields } from "./summary"

/** The arguments of `opencode_run_interrupt`. */
export const interruptInput = z.object({
  session: z.string().min(1).max(MAX_ID).describe("The id of a session a start returned."),
})

/** The result of `opencode_run_interrupt`. */
export const interruptOutput = z.object({
  service_started: z.boolean().describe("True when this call found no service running and started one."),
  session: z.string().describe("The run's session."),
  stopped: z
    .object({
      sessions: z
        .array(z.string())
        .describe(
          "The sessions of the run whose interrupt the service answered as stopped, in the order they were stopped.",
        ),
      commands: z.number().describe("How many commands the run had moved to the background that the call cancelled."),
    })
    .describe("What the call stopped; nothing when the run had nothing active."),
  withdrawn: z.number().describe("How many of the caller's messages the run had not read that the call withdrew."),
  timed_out: z
    .boolean()
    .describe(
      "True when something of the run was still active when the call stopped looking: the run is still running.",
    ),
  background_unchecked: z
    .literal(true)
    .optional()
    .describe(
      "Present when the service has no job routes, so that the commands the run moved to the background were not looked for or cancelled.",
    ),
  message: z.string().describe("What the call leaves as it is: nothing was rolled back."),
  ...runSummaryFields("after the stop"),
})

/** The arguments of a call of `opencode_run_interrupt`. */
export type InterruptInput = z.output<typeof interruptInput>
/** The result of a call of `opencode_run_interrupt`. */
export type InterruptOutput = z.input<typeof interruptOutput>
