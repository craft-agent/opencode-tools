import { z } from "zod"
import { MAX_ID } from "../service/schemas"
import { INSTRUCTION_WHEN } from "./entries"
import { KEY_PREFIX, MAX_ENTRY_NAME } from "./key"

/** The `session` argument of every instruction tool. */
export const sessionArgument = z
  .string()
  .min(1)
  .max(MAX_ID)
  .describe("The id of a session a start returned: the run's own, never a subagent's.")

/** The `key` argument of a tool, whose `description` says what it names. */
export function keyArgument(description: string) {
  return z
    .string()
    .min(1)
    .max(MAX_ID)
    .describe(`${description} Written whole as \`${KEY_PREFIX}<name>\`, the name of 1 to ${MAX_ENTRY_NAME} characters.`)
}

/** The `service_started` field of every instruction result. */
export const serviceStartedField = z.boolean().describe("True when this call found no service running and started one.")

/** The `when` field of a result that changed an entry. */
export const whenField = z
  .enum(INSTRUCTION_WHEN)
  .describe(
    "`next_step`: the run's own session is running, and the agent is told at its next step. `next_turn`: it is told at the head of its next turn.",
  )
