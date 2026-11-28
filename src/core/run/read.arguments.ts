import { methodArguments } from "../methods"
import { runReadInput, type RunReadInput, type RunReadMethod } from "./read.schemas"

type ArgumentName = keyof RunReadInput & string

/** The arguments each method takes besides the shared ones. */
const METHOD_ARGUMENTS: Readonly<Record<RunReadMethod, readonly ArgumentName[]>> = {
  list: ["directory"],
  get: ["session"],
  wait: ["session"],
  messages: ["session", "limit"],
  changes: ["session", "patches"],
}

/** The argument rules of `opencode_run_read`'s methods: what a method refuses, and what it requires. */
export const { refuseForeignArguments, requireArgument } = methodArguments<RunReadInput>({
  names: Object.keys(runReadInput.shape) as ArgumentName[],
  shared: ["method"],
  methods: METHOD_ARGUMENTS,
})
