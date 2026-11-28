import { methodArguments } from "../methods"
import { instructionReadInput, type InstructionReadInput, type InstructionReadMethod } from "./read.schemas"

type ArgumentName = keyof InstructionReadInput & string

/** The arguments each method takes besides the shared ones. */
const METHOD_ARGUMENTS: Readonly<Record<InstructionReadMethod, readonly ArgumentName[]>> = {
  list: [],
  get: ["key"],
}

/** The argument rules of `opencode_instruction_read`'s methods: what a method refuses, and what it requires. */
export const { refuseForeignArguments, requireArgument } = methodArguments<InstructionReadInput>({
  names: Object.keys(instructionReadInput.shape) as ArgumentName[],
  shared: ["method", "session"],
  methods: METHOD_ARGUMENTS,
})
