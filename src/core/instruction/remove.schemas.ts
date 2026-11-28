import { z } from "zod"
import { keyArgument, serviceStartedField, sessionArgument, whenField } from "./schemas"

/** The arguments of `opencode_instruction_remove`. */
export const removeInput = z.object({
  session: sessionArgument,
  key: keyArgument("The key of the entry to remove."),
})

/** The result of `opencode_instruction_remove`. */
export const removeOutput = z.object({
  service_started: serviceStartedField,
  session: z.string().describe("The run's session."),
  key: z.string().describe("The key that was named."),
  removed: z.boolean().describe("False when the session held no such entry: nothing was sent."),
  when: whenField.optional().describe("When the agent is told; present only when `removed`."),
})

/** The arguments of a call of `opencode_instruction_remove`. */
export type RemoveInput = z.output<typeof removeInput>
/** The result of `opencode_instruction_remove`. */
export type RemoveOutput = z.input<typeof removeOutput>
