import { z } from "zod"
import type { Role, Roles } from "../role"

/** The methods of `opencode_service_read`, in the order the schema lists them; a method is added here, in `arguments.ts`, in `CheckedCall` and in the dispatch of `read.ts`. */
export const SERVICE_METHODS = ["status", "agents", "providers", "models", "ready"] as const

/** One method of `opencode_service_read`. */
export type ServiceMethod = (typeof SERVICE_METHODS)[number]

/** The most entries of a list a result keeps. */
export const MAX_LISTED = 100
/** The most variants a result lists for a model. */
export const MAX_VARIANTS = 20
/** The most code points of an agent's, a provider's or a model's name a result keeps. */
export const MAX_NAME = 100
/** The most code points of an agent's description a result keeps. */
export const MAX_DESCRIPTION = 300
/** The most characters of the `match` argument. */
export const MAX_MATCH = 100
/** The most code points of an agent's, a provider's, a model's or a variant's id a result keeps: a cut id could not be used in a later call. */
export const MAX_ID = 200
/** The most characters the entries of one list take as JSON. */
export const MAX_LIST_CHARS = 20_000

/** The most characters of a `role` argument. */
export const MAX_ROLE_NAME = 64

/** What `ready` can find wrong, in the order it checks. */
export const FINDING_CODES = [
  "not_a_repository",
  "agent_missing",
  "agent_not_primary",
  "agent_hidden",
  "model_unavailable",
  "variant_unavailable",
  "no_model",
] as const

/** One thing `ready` can find wrong. */
export type FindingCode = (typeof FINDING_CODES)[number]

const policies = ["read-only", "write"] as const

export const serviceReadInput = z.object({
  method: z
    .enum(SERVICE_METHODS)
    .describe(
      "What to read: `status` the service's version and the roles, `agents` the agents of a directory, `providers` the providers the service can use there, `models` the models of one provider, `ready` whether a role can run in a directory.",
    ),
  directory: z
    .string()
    .optional()
    .describe(
      "Methods `agents`, `providers`, `models` and `ready`: the absolute path of the directory to ask about; left out, the call's working directory.",
    ),
  provider: z
    .string()
    .min(1)
    .max(MAX_ID)
    .optional()
    .describe("Method `models`, required there: a provider's id as `providers` lists it."),
  match: z
    .string()
    .min(1)
    .max(MAX_MATCH)
    .optional()
    .describe("Method `models`: keeps the models whose id or name contains this text, whatever its case."),
  role: z
    .string()
    .min(1)
    .max(MAX_ROLE_NAME)
    .optional()
    .describe("Method `ready`, required there: a role's name as `status` lists it."),
})

const roleSchema = z.object({
  name: z.string(),
  agent: z.string().describe("The OpenCode agent the role runs."),
  policy: z.enum(policies),
  model: z.string().nullable().describe("The role's model written `<provider>/<model>`; null when it names none."),
})

const agentSchema = z.object({
  id: z.string(),
  name: z.string(),
  mode: z.string().describe("`primary`, `subagent`, or `all`, which can run as either."),
  hidden: z.boolean().describe("True for an agent OpenCode keeps for its own use."),
  model: z.string().nullable().describe("The agent's own model written `<provider>/<model>`; null when it has none."),
  description: z.string().nullable(),
})

const providerSchema = z.object({
  id: z.string(),
  name: z.string(),
  models: z.number().describe("How many models of this provider the service can use there."),
})

const modelSchema = z.object({
  id: z.string().describe("The model's id, the `<model>` of `<provider>/<model>`."),
  name: z.string(),
  status: z.string().describe("`active`, `beta`, `alpha` or `deprecated`."),
  variants: z.array(z.string()).describe(`The ids of the model's variants, at most ${MAX_VARIANTS}.`),
})

const findingSchema = z.object({
  code: z.enum(FINDING_CODES),
  message: z.string(),
})

export const serviceReadOutput = z.object({
  method: z.enum(SERVICE_METHODS).describe("The method that was read."),
  service_started: z.boolean().describe("True when this call found no service running and started one."),
  version: z.string().optional().describe("Method `status`: the OpenCode version the service reports."),
  roles: z
    .array(roleSchema)
    .optional()
    .describe("Method `status`: the roles a run can start under, in the order they are configured."),
  directory: z
    .string()
    .optional()
    .describe("Methods `agents`, `providers`, `models` and `ready`: the directory that was asked about."),
  agents: z
    .array(agentSchema)
    .optional()
    .describe("Method `agents`: the agents of the directory, in the order the service gives them."),
  providers: z
    .array(providerSchema)
    .optional()
    .describe("Method `providers`: the providers the service can use in the directory."),
  provider: z.string().optional().describe("Method `models`: the provider whose models are listed."),
  models: z
    .array(modelSchema)
    .optional()
    .describe("Method `models`: the provider's models, newest first, that match `match` when it is given."),
  total: z
    .number()
    .optional()
    .describe("Methods `agents`, `providers` and `models`: how many there are, or how many match."),
  truncated: z
    .boolean()
    .optional()
    .describe("Methods `agents`, `providers` and `models`: true when entries, or a model's variants, were left out."),
  role: z.string().optional().describe("Method `ready`: the role that was checked."),
  ready: z.boolean().optional().describe("Method `ready`: true when the role can run in the directory."),
  summary: z.string().optional().describe("Method `ready`: one line saying so."),
  findings: z
    .array(findingSchema)
    .optional()
    .describe("Method `ready`: what is wrong, in the order it was checked; empty when `ready` is true."),
})

export type ServiceReadInput = z.output<typeof serviceReadInput>
export type ServiceReadOutput = z.infer<typeof serviceReadOutput>

/**
 * A call whose arguments and context have been checked, with what the checks
 * resolved: nothing about it can be refused once the service is connected.
 */
export type CheckedCall =
  | { method: "status"; roles: Roles }
  | { method: "agents"; directory: string }
  | { method: "providers"; directory: string }
  | { method: "models"; directory: string; provider: string; match?: string }
  | { method: "ready"; directory: string; role: { name: string; role: Role } }

/** The checked call of one method. */
export type CallOf<Method extends ServiceMethod> = Extract<CheckedCall, { method: Method }>
