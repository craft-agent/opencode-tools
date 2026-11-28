import { z } from "zod"
import { MAX_ENTRY_VALUE } from "./limits"
import { keyArgument, serviceStartedField, sessionArgument, whenField } from "./schemas"

/** The arguments of `opencode_instruction_set`. */
export const setInput = z.object({
  session: sessionArgument,
  key: keyArgument("The key of the entry to set."),
  value: z
    .string()
    .min(1)
    .max(MAX_ENTRY_VALUE)
    .describe(`The text the agent is told: 1 to ${MAX_ENTRY_VALUE} characters, not blank.`),
})

/** The result of `opencode_instruction_set`. */
export const setOutput = z.object({
  service_started: serviceStartedField,
  session: z.string().describe("The run's session."),
  key: z.string().describe("The key the agent was told the value under."),
  changed: z
    .boolean()
    .describe("False when the entry already held this value: nothing was sent, and the agent is told nothing."),
  replaced: z.boolean().describe("True when the key held another value, which this one replaced."),
  when: whenField.optional().describe("When the agent is told; present only when `changed`."),
})

/** The arguments of a call of `opencode_instruction_set`. */
export type SetInput = z.output<typeof setInput>
/** The result of `opencode_instruction_set`. */
export type SetOutput = z.input<typeof setOutput>
