import { z } from "zod"
import { ToolError, type JsonValue } from "../errors"
import type { Rule } from "../run/rule"
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

const rule = z.looseObject({ action: z.string(), resource: z.string(), effect: z.enum(["allow", "deny", "ask"]) })

const session = z.looseObject({
  id,
  parentID: id.optional(),
  projectID: id,
  agent: z.string().optional(),
  model: modelRef.optional(),
  permissions: z.array(rule).optional(),
  metadata: z.record(z.string(), z.json()).optional(),
  location: z.looseObject({ directory: id }),
  time: z.looseObject({
    created: z.number(),
    updated: z.number(),
    busy: z.number().optional(),
    idle: z.number().optional(),
  }),
  title: z.string().optional(),
  outcome: z.enum(["succeeded", "failed", "interrupted"]).optional(),
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
/** A session as the handlers read it. */
export type SessionEntry = {
  id: string
  parentID?: string
  projectID: string
  agent?: string
  model?: { providerID: string; id: string; variant?: string }
  /** As stored: a list of { action, resource, effect }; absent when the session has none. */
  permissions?: Rule[]
  /** The session's metadata as stored: any JSON object. */
  metadata?: Record<string, JsonValue>
  directory: string
  time: { created: number; updated: number; busy?: number; idle?: number }
  title?: string
  outcome?: "succeeded" | "failed" | "interrupted"
}

/**
 * The reply as `schema` reads it. The client does not validate JSON, so each
 * reply is checked where it is read, against the fields the handlers consume
 * and no others: a reply of the wrong shape is `upstream_error`, never a
 * `TypeError` and never a half-empty value taken for an answer.
 */
export function read<T>(schema: z.ZodType<T>, reply: unknown): T {
  const parsed = schema.safeParse(reply)
  if (!parsed.success) throw new ToolError("upstream_error", UNREADABLE_REPLY)
  return parsed.data
}

/** The version and the scratch directory a `server.info` reply gives; `tmp` is absent when the service reports none. */
export function infoOf(reply: unknown): { version: string; tmp?: string } {
  const info = read(
    z.looseObject({ version: z.string(), paths: z.looseObject({ tmp: z.unknown().optional() }).optional() }),
    reply,
  )
  const tmp = info.paths?.tmp
  return typeof tmp === "string" && tmp !== "" ? { version: info.version, tmp } : { version: info.version }
}

function entryOf(row: z.output<typeof session>): SessionEntry {
  const {
    id: sessionId,
    parentID,
    projectID,
    agent,
    model,
    permissions,
    metadata,
    location,
    time,
    title,
    outcome,
  } = row
  return {
    id: sessionId,
    projectID,
    directory: location.directory,
    time,
    ...(parentID !== undefined && { parentID }),
    ...(agent !== undefined && { agent }),
    ...(model !== undefined && { model }),
    ...(permissions !== undefined && { permissions }),
    ...(metadata !== undefined && { metadata }),
    ...(title !== undefined && { title }),
    ...(outcome !== undefined && { outcome }),
  }
}

/** The session of a `session.get` reply. */
export function sessionOf(reply: unknown): SessionEntry {
  return entryOf(read(session, reply))
}

/** The sessions of one page of `session.list`, whose reply is `{ data, cursor }`. */
export function sessionsOf(reply: unknown): SessionEntry[] {
  return read(z.looseObject({ data: z.array(session) }), reply).data.map(entryOf)
}

/** One page of `session.list` with the cursor of the next, which is absent on the last page. */
export function sessionPageOf(reply: unknown): { sessions: SessionEntry[]; next?: string } {
  const page = read(
    z.looseObject({
      data: z.array(session),
      cursor: z.looseObject({ next: z.string().nullish() }),
    }),
    reply,
  )
  const next = page.cursor.next
  return { sessions: page.data.map(entryOf), ...(next ? { next } : {}) }
}

/** The ids `session.active` lists. */
export function activeOf(reply: unknown): Set<string> {
  return new Set(Object.keys(read(z.record(z.string(), z.unknown()), reply)))
}

/** The id of the inbox item a prompt was admitted as. */
export function admittedOf(reply: unknown): string {
  return read(z.looseObject({ id }), reply).id
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
