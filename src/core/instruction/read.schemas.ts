import { z } from "zod"
import { MAX_ENTRIES_LISTED } from "./limits"
import { keyArgument, serviceStartedField, sessionArgument } from "./schemas"

/** The methods of `opencode_instruction_read`, in the order the schema lists them; a method is added here, in `read.arguments.ts`, in `CheckedCall` and in the dispatch of `read.tool.ts`. */
export const INSTRUCTION_READ_METHODS = ["list", "get"] as const

/** One method of `opencode_instruction_read`. */
export type InstructionReadMethod = (typeof INSTRUCTION_READ_METHODS)[number]

/** The arguments of `opencode_instruction_read`: one `method`, and the arguments that method takes (`read.arguments.ts` checks which). */
export const instructionReadInput = z.object({
  method: z
    .enum(INSTRUCTION_READ_METHODS)
    .describe("What to read: `list` the package's entries of the session, `get` one entry whole."),
  session: sessionArgument,
  key: keyArgument(
    "Method `get`, required there: the key of the entry to read, the operating note's included.",
  ).optional(),
})

const entryOut = z.object({
  key: z.string().describe("The key the agent reads beside the value."),
  value: z.string().describe("The value: a text as it is, any other JSON as its JSON text (`json`)."),
  value_truncated: z.literal(true).optional().describe("True when `value` was cut."),
  json: z.literal(true).optional().describe("True when the value is not a text: `value` is its JSON text."),
  read_only: z.literal(true).optional().describe("True for the operating note, which no call can set or remove."),
})

/** The result of `opencode_instruction_read`: the fields every method has, and those of the method that was read, each left out by the other. */
export const instructionReadOutput = z.object({
  method: z.enum(INSTRUCTION_READ_METHODS).describe("The method that was read."),
  service_started: serviceStartedField,
  session: z.string().describe("The run's session."),
  entries: z
    .array(entryOut)
    .optional()
    .describe(`Method \`list\`: the package's entries, at most ${MAX_ENTRIES_LISTED}, in the service's order.`),
  total: z
    .number()
    .optional()
    .describe("Method `list`: how many entries of the package there are, when some were left out."),
  truncated: z.literal(true).optional().describe("Method `list`: true when entries were left out."),
  others: z
    .number()
    .optional()
    .describe("Method `list`: how many entries the session holds under other keys, which are not shown."),
  entry: entryOut.optional().describe("Method `get`: the entry."),
})

/** The arguments of a call of `opencode_instruction_read`. */
export type InstructionReadInput = z.output<typeof instructionReadInput>
/** The result of `opencode_instruction_read`. */
export type InstructionReadOutput = z.input<typeof instructionReadOutput>
/** One entry of a result. */
export type EntryOut = z.input<typeof entryOut>

/**
 * A call whose arguments have been checked, with what the checks resolved:
 * nothing about it can be refused once the service is connected.
 */
export type CheckedCall = { method: "list"; session: string } | { method: "get"; session: string; key: string }

/** The checked call of one method. */
export type CallOf<Method extends InstructionReadMethod> = Extract<CheckedCall, { method: Method }>
