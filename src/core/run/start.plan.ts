import { randomUUID } from "node:crypto"
import { ToolError } from "../errors"
import type { Policy, Role } from "../role"
import { runtimeOf } from "../runtime"
import type { ServiceConnection } from "../service/connect"
import { agentsOf, defaultModelOf, modelsOf, type SessionEntry } from "../service/reply"
import { resolveRole, type ModelRef } from "../service/resolve"
import type { ToolContext } from "../tool"
import { BINDING_VERSION, type Binding } from "./binding"
import { consumerRulesOf, readRootsOf } from "./options"
import type { Rule } from "./rule"
import { rulesetOf } from "./ruleset"
import { scratchDirectories, withResolved } from "./scratch"
import type { Worktree } from "./worktree"

/** The agent and the model a role resolves to in a loaded directory. */
export type ResolvedStart = { agent: string; model: ModelRef }

/**
 * Resolves the role as `opencode_service_read` method `ready` does, before a
 * session exists: any finding is `invalid_argument` carrying the findings'
 * messages and their codes.
 */
export async function resolveStartRole(
  service: ServiceConnection,
  directory: string,
  name: string,
  role: Role,
): Promise<ResolvedStart> {
  const location = { location: { directory } }
  const { client } = service
  const [agents, models, fallback] = await Promise.all([
    client.agent.list(location),
    client.model.list(location),
    client.model.default(location),
  ])
  const resolved = resolveRole(name, role, agentsOf(agents), modelsOf(models), defaultModelOf(fallback))
  if (resolved.findings.length > 0 || resolved.model === undefined) {
    throw new ToolError("invalid_argument", resolved.findings.map((finding) => finding.message).join(" "), {
      details: { findings: resolved.findings.map((finding) => finding.code) },
    })
  }
  return { agent: role.agent, model: resolved.model }
}

/**
 * The model a start sets: the resolved one when the role names a model, else
 * the model a continued session already has, since the service may have moved
 * it to another and the role says nothing about it.
 */
export function modelOfStart(role: Role, resolved: ModelRef, session: SessionEntry | undefined): ModelRef {
  return role.model === undefined && session?.model !== undefined ? session.model : resolved
}

/** The ruleset of a run of `policy`: the package's rules, the consumer's for the policy, and the service's own directories and the read roots as the file system spells them. */
export async function rulesetFor(service: ServiceConnection, policy: Policy, ctx: ToolContext): Promise<Rule[]> {
  return rulesetOf({
    policy,
    scratch: await withResolved(scratchDirectories(runtimeOf(ctx).env, service.tmp)),
    readRoots: await withResolved(readRootsOf(ctx.options)),
    rules: consumerRulesOf(ctx.options)[policy] ?? [],
  })
}

/** The binding of a start, marked with the time and a token of this call. */
export function bindingFor(ctx: ToolContext, role: string, worktree: Worktree): Binding {
  return {
    v: BINDING_VERSION,
    caller: ctx.caller,
    role,
    repository: worktree.repository,
    branch: worktree.branch,
    starting: { at: runtimeOf(ctx).now(), token: randomUUID() },
  }
}
