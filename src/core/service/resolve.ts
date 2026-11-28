import { VARIANT_DEFAULT, modelText, parseModel, type Role } from "../role"
import { shown } from "../text"
import { cleaned } from "./errors"
import type { AgentEntry, ModelEntry, ModelId } from "./reply"
import { MAX_VARIANTS, type FindingCode } from "./schemas"

/** A model with the variant a run starts with, when it has one. */
export type ModelRef = ModelId & { variant?: string }
/** One thing wrong with a role's agent or model. */
export type RoleFinding = { code: FindingCode; message: string }
/** A role as a loaded directory resolves it. */
export type ResolvedRole = {
  /** The role's agent, when the directory has it. */
  agent?: AgentEntry
  /** The model a run under the role starts with; absent when none resolves. */
  model?: ModelRef
  /** What is wrong with the agent or the model; empty when a run can start. */
  findings: RoleFinding[]
}

type Resolution = { model?: ModelRef; findings: RoleFinding[] }

/** The modes in which an agent can hold a run; `all` can run as a primary agent, and any other mode, `subagent` or one a later service adds, cannot. */
const RUNNING_MODES = ["primary", "all"]

/** A finding for a variant the model does not have; the variant `default`, which means none, is always there. */
function variantFindings(ref: ModelRef, model: ModelEntry): RoleFinding[] {
  const { variant } = ref
  if (variant === undefined || variant === VARIANT_DEFAULT) return []
  const ids = model.variants.map((candidate) => candidate.id)
  if (ids.includes(variant)) return []
  const has = ids.length === 0 ? "none" : cleaned(ids.slice(0, MAX_VARIANTS).join(", "))
  return [
    {
      code: "variant_unavailable",
      message: `Model ${cleaned(modelText({ ...ref, variant: undefined }))} has no variant ${cleaned(variant)}; it has: ${has}.`,
    },
  ]
}

/**
 * The model a run under the role starts with, as the service resolves it: the
 * role's own model, which must be one the service can use there; else the
 * agent's, when the service can use it; else the service's default.
 */
function resolveModel(
  name: string,
  role: Role,
  agent: AgentEntry | undefined,
  models: readonly ModelEntry[],
  fallback: ModelId | undefined,
): Resolution {
  const listed = (ref: ModelId) => models.find((model) => model.providerID === ref.providerID && model.id === ref.id)
  const parsed = role.model === undefined ? undefined : parseModel(role.model)
  if (parsed !== undefined) {
    const ref = { providerID: parsed.providerID, id: parsed.modelID, variant: parsed.variant }
    const model = listed(ref)
    if (model === undefined) {
      const written = cleaned(modelText({ ...ref, variant: undefined }))
      return {
        findings: [
          {
            code: "model_unavailable",
            message: `Role ${name}'s model ${written} is not a model the service can use here; method models lists a provider's.`,
          },
        ],
      }
    }
    return { model: ref, findings: variantFindings(ref, model) }
  }
  const own = agent?.model ?? undefined
  const ownListed = own === undefined ? undefined : listed(own)
  if (own !== undefined && ownListed !== undefined) return { model: own, findings: variantFindings(own, ownListed) }
  if (fallback) return { model: fallback, findings: [] }
  return {
    findings: [
      {
        code: "no_model",
        message: `Role ${name} names no model, its agent has none the service can use, and the service has no default model.`,
      },
    ],
  }
}

/** Resolves a role against what a loaded directory offers, as the service will: pure. */
export function resolveRole(
  name: string,
  role: Role,
  agents: readonly AgentEntry[],
  models: readonly ModelEntry[],
  fallback: ModelId | undefined,
): ResolvedRole {
  const findings: RoleFinding[] = []
  const agent = agents.find((candidate) => candidate.id === role.agent)
  const whose = `Role ${name}'s agent ${shown(role.agent)}`
  if (agent === undefined) {
    findings.push({
      code: "agent_missing",
      message: `${whose} is not an agent of this directory; method agents lists them.`,
    })
  } else {
    if (!RUNNING_MODES.includes(agent.mode)) {
      findings.push({
        code: "agent_not_primary",
        message: `${whose} is not a primary agent (its mode is ${shown(agent.mode)}); a run needs one.`,
      })
    }
    if (agent.hidden) {
      findings.push({ code: "agent_hidden", message: `${whose} is hidden: OpenCode keeps it for its own use.` })
    }
  }
  const resolution = resolveModel(name, role, agent, models, fallback)
  findings.push(...resolution.findings)
  return { agent, model: resolution.model, findings }
}
