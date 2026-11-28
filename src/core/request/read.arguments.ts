import { methodArguments } from "../methods"
import { requestReadInput, type RequestReadInput, type RequestReadMethod } from "./read.schemas"

type ArgumentName = keyof RequestReadInput & string

/** The arguments each method takes besides the shared ones. */
const METHOD_ARGUMENTS: Readonly<Record<RequestReadMethod, readonly ArgumentName[]>> = {
  list: ["session"],
  get: ["session", "request"],
}

/** The argument rules of `opencode_request_read`'s methods: what a method refuses, and what it requires. */
export const { refuseForeignArguments, requireArgument } = methodArguments<RequestReadInput>({
  names: Object.keys(requestReadInput.shape) as ArgumentName[],
  shared: ["method"],
  methods: METHOD_ARGUMENTS,
})
