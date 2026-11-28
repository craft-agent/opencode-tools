import { ToolError, isAbortError } from "../errors"
import { modelText, rolesOf, type Role } from "../role"
import { runtimeOf } from "../runtime"
import { shown } from "../text"
import type { ToolContext } from "../tool"
import { requireArgument } from "./arguments"
import type { ServiceConnection } from "./connect"
import { cleaned } from "./errors"
import { BRANCH_TIMEOUT_MS, LOCATION_POLL_MS } from "./location"
import { agentsOf, defaultModelOf, locationOf, modelsOf, projectOf, vcsOf, type VcsEntry } from "./reply"
import { resolveRole, type RoleFinding } from "./resolve"
import type { CallOf, ServiceReadInput, ServiceReadOutput } from "./schemas"

const GIT = "git"

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

  const findings: RoleFinding[] = []
  if (!repository) {
    findings.push({ code: "not_a_repository", message: `${cleaned(directory)} is not in a Git repository.` })
  }
  const resolved = resolveRole(name, role, agents, models, fallback)
  findings.push(...resolved.findings)

  const base = { method: "ready" as const, service_started: service.started, directory, role: name, findings }
  if (findings.length > 0 || resolved.model === undefined) {
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
    summary: `Role ${name} is ready in ${cleaned(directory)}: agent ${cleaned(role.agent)}, model ${cleaned(modelText(resolved.model))}${branch ? `, branch ${cleaned(branch)}` : ""}.`,
  }
}
