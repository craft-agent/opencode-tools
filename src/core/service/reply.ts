import { z } from "zod"
import { ToolError } from "../errors"
import { UNREADABLE_REPLY } from "./errors"

/** An id a result or a decision uses: an empty one names nothing. */
const id = z.string().min(1)

const modelRef = z.looseObject({
  providerID: id,
  id,
  variant: z.string().optional(),
})

const agent = z.looseObject({
  id,
  name: z.string(),
  mode: z.string(),
  hidden: z.boolean(),
  model: modelRef.nullish(),
  description: z.string().nullish(),
})

const model = z.looseObject({
  id,
  providerID: id,
  name: z.string(),
  status: z.string(),
  variants: z.array(z.looseObject({ id: z.string() })),
})

const provider = z.looseObject({ id, name: z.string() })

const defaultModel = z.looseObject({ id, providerID: id })

const plugin = z.looseObject({ state: z.looseObject({ status: z.string() }) })

const project = z.looseObject({ id, vcs: z.string().nullish() })

const vcs = z.looseObject({
  provider: z.string().nullish(),
  branch: z.looseObject({ current: z.string().nullish() }),
})

/** An agent as the handlers read it. */
export type AgentEntry = z.output<typeof agent>
/** A model as the handlers read it. */
export type ModelEntry = z.output<typeof model>
/** A provider as the handlers read it. */
export type ProviderEntry = z.output<typeof provider>
/** A model written by its provider and its id. */
export type ModelId = { providerID: string; id: string }
/** What a directory's version control says, as the handlers read it. */
export type VcsEntry = z.output<typeof vcs>

/**
 * The reply as `schema` reads it. The client does not validate JSON, so each
 * reply is checked where it is read, against the fields the handlers consume
 * and no others: a reply of the wrong shape is `upstream_error`, never a
 * `TypeError` and never a half-empty value taken for an answer.
 */
function read<T>(schema: z.ZodType<T>, reply: unknown): T {
  const parsed = schema.safeParse(reply)
  if (!parsed.success) throw new ToolError("upstream_error", UNREADABLE_REPLY)
  return parsed.data
}

/** The agents of an `agent.list` reply. */
export function agentsOf(reply: unknown): AgentEntry[] {
  return read(z.looseObject({ data: z.array(agent) }), reply).data
}

/** The models of a `model.list` reply. */
export function modelsOf(reply: unknown): ModelEntry[] {
  return read(z.looseObject({ data: z.array(model) }), reply).data
}

/** The providers of a `provider.list` reply. */
export function providersOf(reply: unknown): ProviderEntry[] {
  return read(z.looseObject({ data: z.array(provider) }), reply).data
}

/** The model of a `model.default` reply; `undefined` when the service has none, which it says as `null` or by leaving `data` out. */
export function defaultModelOf(reply: unknown): ModelId | undefined {
  const data = read(z.looseObject({ data: defaultModel.nullish() }), reply).data
  return data ? { providerID: data.providerID, id: data.id } : undefined
}

/** The version control state of a `vcs.get` reply. */
export function vcsOf(reply: unknown): VcsEntry {
  return read(z.looseObject({ data: vcs }), reply).data
}

/** The plugins of a `plugin.list` reply; only how many there are is of use, since the service lists none until a directory is loaded. */
export function pluginsOf(reply: unknown): Record<string, unknown>[] {
  return read(z.looseObject({ data: z.array(plugin) }), reply).data
}

/** The project a `location.get` reply puts the directory in. */
export function locationOf(reply: unknown): { project: { id: string } } {
  return read(z.looseObject({ project: z.looseObject({ id }) }), reply)
}

/**
 * The row of a `project.list` reply whose id is `projectId`, with the version
 * control the service found in it, if any; `undefined` when there is none. A
 * person's list of projects has no size limit here, so only the row looked
 * for is read: the others are not parsed or copied, and a malformed one that
 * is not the row looked for is of no concern.
 */
export function projectOf(reply: unknown, projectId: string): { id: string; vcs?: string | null } | undefined {
  if (!Array.isArray(reply)) throw new ToolError("upstream_error", UNREADABLE_REPLY)
  const row: unknown = reply.find(
    (candidate: unknown) =>
      typeof candidate === "object" && candidate !== null && (candidate as { id?: unknown }).id === projectId,
  )
  return row === undefined ? undefined : read(project, row)
}
