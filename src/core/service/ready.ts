import { ToolError, isAbortError } from "../errors"
import { VARIANT_DEFAULT, modelText, parseModel, rolesOf, type Role } from "../role"
import { runtimeOf } from "../runtime"
import { shown } from "../text"
import type { ToolContext } from "../tool"
import { requireArgument } from "./arguments"
import type { ServiceConnection } from "./connect"
import { cleaned } from "./errors"
import { BRANCH_TIMEOUT_MS, LOCATION_POLL_MS } from "./location"
import {
  agentsOf,
  defaultModelOf,
  locationOf,
  modelsOf,
  projectOf,
  vcsOf,
  type AgentEntry,
  type ModelEntry,
  type ModelId,
  type VcsEntry,
} from "./reply"
import { MAX_VARIANTS, type CallOf, type FindingCode, type ServiceReadInput, type ServiceReadOutput } from "./schemas"

type Finding = { code: FindingCode; message: string }
type ModelRef = ModelId & { variant?: string }
type Resolution = { model?: ModelRef; findings: Finding[] }

const GIT = "git"
/** The modes in which an agent can hold a run; `all` can run as a primary agent, and any other mode, `subagent` or one a later service adds, cannot. */
const RUNNING_MODES = ["primary", "all"]

/** The role `args` names, which must be one of the configured roles: `invalid_argument` listing them otherwise. */
export function configuredRole(
  args: ServiceReadInput,
  ctx: Pick<ToolContext, "options">,
): { name: string; role: Role } {
  const name = requireArgument(args, "role")
  const roles = rolesOf(ctx.options)
  const role = roles[name]
  if (role === undefined) {
    throw new ToolError(
      "invalid_argument",
      `No role ${shown(name)} is configured; the roles are: ${Object.keys(roles).join(", ")}.`,
    )
  }
  return { name, role }
}

/** A finding for a variant the model does not have; the variant `default`, which means none, is always there. */
function variantFindings(ref: ModelRef, model: ModelEntry): Finding[] {
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
  models: ModelEntry[],
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

/**
 * What `vcs.get` says of a directory once it has settled. A directory just
 * loaded answers with no provider for a short while, so it is asked again,
 * every `LOCATION_POLL_MS` and for at most `BRANCH_TIMEOUT_MS`, or what the
 * call's time has left when that is less, and what was read last stands after
 * that. A retry that fails, but for the call's own
 * abort, ends the retrying and leaves the last reply standing: a failed look
 * must not fail the check. With a provider, there is no retry.
 */
async function settledVcs(
  service: ServiceConnection,
  directory: string,
  first: VcsEntry,
  ctx: Pick<ToolContext, "signal" | "runtime">,
): Promise<VcsEntry> {
  const rt = runtimeOf(ctx)
  const endsAt = rt.now() + service.deadline.within(BRANCH_TIMEOUT_MS)
  let vcs = first
  while (!vcs.provider && rt.now() < endsAt) {
    await rt.sleep(LOCATION_POLL_MS, ctx.signal)
    try {
      vcs = vcsOf(await service.client.vcs.get({ location: { directory } }))
    } catch (error) {
      if (isAbortError(error)) throw error
      break
    }
  }
  return vcs
}

/** Method `ready`: whether the role can run in the directory, and what is wrong when it cannot. */
export async function readReady(
  checked: CallOf<"ready">,
  service: ServiceConnection,
  ctx: Pick<ToolContext, "signal" | "runtime">,
): Promise<ServiceReadOutput> {
  const { directory, role: checkedRole } = checked
  const { name, role } = checkedRole
  const location = { location: { directory } }
  const { client } = service
  const [locationReply, projectsReply, vcsReply, agentsReply, modelsReply, defaultReply] = await Promise.all([
    client.location.get(location),
    client.project.list(),
    client.vcs.get(location),
    client.agent.list(location),
    client.model.list(location),
    client.model.default(location),
  ])
  // The service's project for the directory says whether it is in a Git repository; where it keeps none, `vcs.get` does, once it has settled. A call waits for that once.
  const vcs = vcsOf(vcsReply)
  let settled: VcsEntry | undefined
  const settle = async () => (settled ??= await settledVcs(service, directory, vcs, ctx))
  const project = projectOf(projectsReply, locationOf(locationReply).project.id)
  const repository = project === undefined ? (await settle()).provider === GIT : project.vcs === GIT
  const agents = agentsOf(agentsReply)
  const models = modelsOf(modelsReply)
  const fallback = defaultModelOf(defaultReply)

  const findings: Finding[] = []
  if (!repository) {
    findings.push({ code: "not_a_repository", message: `${cleaned(directory)} is not in a Git repository.` })
  }
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

  const base = { method: "ready" as const, service_started: service.started, directory, role: name, findings }
  if (findings.length > 0 || resolution.model === undefined) {
    const count = findings.length
    return {
      ...base,
      ready: false,
      summary: `Role ${name} is not ready in ${cleaned(directory)}: ${count} finding${count === 1 ? "" : "s"}.`,
    }
  }
  const branch = (await settle()).branch.current
  return {
    ...base,
    ready: true,
    summary: `Role ${name} is ready in ${cleaned(directory)}: agent ${cleaned(role.agent)}, model ${cleaned(modelText(resolution.model))}${branch ? `, branch ${cleaned(branch)}` : ""}.`,
  }
}
