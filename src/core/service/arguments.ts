import { methodArguments } from "../methods"
import { serviceReadInput, type ServiceMethod, type ServiceReadInput } from "./schemas"

type ArgumentName = keyof ServiceReadInput & string

/** The arguments each method takes besides the shared ones. */
const METHOD_ARGUMENTS: Readonly<Record<ServiceMethod, readonly ArgumentName[]>> = {
  status: [],
  agents: ["directory"],
  providers: ["directory"],
  models: ["directory", "provider", "match"],
  ready: ["directory", "role"],
}

/** The argument rules of `opencode_service_read`'s methods: what a method refuses, and what it requires. */
export const { refuseForeignArguments, requireArgument } = methodArguments<ServiceReadInput>({
  names: Object.keys(serviceReadInput.shape) as ArgumentName[],
  shared: ["method"],
  methods: METHOD_ARGUMENTS,
})
