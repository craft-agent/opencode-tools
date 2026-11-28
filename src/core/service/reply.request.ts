import { z } from "zod"
import { read } from "./reply"
import { diffEntry, type DiffEntry } from "./reply.run"

/** An id a result uses: an empty one names nothing. */
const id = z.string().min(1)

/** A property that is absent when it has another type: a reply is not failed for what only adds detail. */
function lenient<T extends z.ZodType>(schema: T) {
  return schema.optional().catch(undefined)
}

/** The entries of `values` that are not `undefined`. */
function present<T extends object>(values: T): Partial<T> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Partial<T>
}

const source = z.looseObject({ messageID: id, id })
const permission = z.looseObject({
  id,
  action: z.string(),
  resources: z.array(z.string()),
  source: lenient(source),
  message: lenient(z.string()),
  metadata: lenient(z.record(z.string(), z.unknown())),
})

const option = z.looseObject({ value: z.string(), label: lenient(z.string()), description: lenient(z.string()) })
const bound = z.union([z.number(), z.enum(["Infinity", "-Infinity", "NaN"])])
const fieldDefault = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])
const field = z.looseObject({
  key: z.string(),
  type: z.string(),
  title: lenient(z.string()),
  description: lenient(z.string()),
  required: lenient(z.boolean()),
  custom: lenient(z.boolean()),
  options: lenient(z.array(lenient(option))),
  default: lenient(fieldDefault),
  minimum: lenient(bound),
  maximum: lenient(bound),
  minLength: lenient(z.number()),
  maxLength: lenient(z.number()),
  minItems: lenient(z.number()),
  maxItems: lenient(z.number()),
  pattern: lenient(z.string()),
  format: lenient(z.string()),
  url: lenient(z.string()),
})
const form = z.looseObject({ id, title: z.string(), fields: z.array(field) })

const toolPart = z.looseObject({
  type: z.literal("tool"),
  id,
  name: z.string(),
  state: lenient(z.looseObject({ input: lenient(z.record(z.string(), z.unknown())) })),
})
const message = z.looseObject({ content: z.array(z.unknown()) })

/** A permission request a session is paused on, whole. */
export type PermissionRequestEntry = {
  id: string
  action: string
  resources: string[]
  /** The tool call that asked: the assistant message holding it and its id; absent when the request does not name both. */
  source?: { messageID: string; id: string }
  message?: string
  metadata?: Record<string, unknown>
}

/** One choice of a field. */
export type FieldOptionEntry = { value: string; label?: string; description?: string }

/** A field of a question, with the properties of the service's field kinds; one of another type is absent. */
export type FieldEntry = {
  key: string
  type: string
  title?: string
  description?: string
  required?: boolean
  custom?: boolean
  options?: FieldOptionEntry[]
  default?: string | number | boolean | string[]
  minimum?: number | string
  maximum?: number | string
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
  pattern?: string
  format?: string
  url?: string
}

/** A question a session is paused on, with its fields. */
export type FormDetailEntry = { id: string; title: string; fields: FieldEntry[] }

/** The tool call a request names: the tool, and its arguments when they are a plain object (a call still streaming has them as text). */
export type ToolCallEntry = { tool: string; input?: Record<string, unknown> }

/** A file a request would change, with its patch. */
export type ChangedFile = Pick<DiffEntry, "file" | "status" | "additions" | "deletions" | "patch">

/** The requests of a `permission.list` reply, whole. */
export function permissionRequestsOf(reply: unknown): PermissionRequestEntry[] {
  return read(z.array(permission), reply).map((request) => ({
    id: request.id,
    action: request.action,
    resources: request.resources,
    ...(request.source !== undefined && { source: { messageID: request.source.messageID, id: request.source.id } }),
    ...present({ message: request.message, metadata: request.metadata }),
  }))
}

function fieldOf(row: z.output<typeof field>): FieldEntry {
  const options = row.options?.filter((candidate) => candidate !== undefined)
  return {
    key: row.key,
    type: row.type,
    ...present({
      title: row.title,
      description: row.description,
      required: row.required,
      custom: row.custom,
      options: options?.map(({ value, label, description }) => ({ value, ...present({ label, description }) })),
      default: row.default,
      minimum: row.minimum,
      maximum: row.maximum,
      minLength: row.minLength,
      maxLength: row.maxLength,
      minItems: row.minItems,
      maxItems: row.maxItems,
      pattern: row.pattern,
      format: row.format,
      url: row.url,
    }),
  }
}

/** The forms of a `session.form.list` reply, with their fields; only a field's `key` and `type` are required of it. */
export function formDetailsOf(reply: unknown): FormDetailEntry[] {
  return read(z.array(form), reply).map((row) => ({ id: row.id, title: row.title, fields: row.fields.map(fieldOf) }))
}

/**
 * The tool call `callID` of a `session.message.get` reply. A reply that is not
 * an assistant message, or a call that is not there, is no call; so is a call
 * whose arguments are not a plain object, for its `input`.
 */
export function toolCallOf(reply: unknown, callID: string): ToolCallEntry | undefined {
  const parsed = message.safeParse(reply)
  if (!parsed.success) return undefined
  for (const item of parsed.data.content) {
    const part = toolPart.safeParse(item)
    if (part.success && part.data.id === callID) {
      const input = part.data.state?.input
      return { tool: part.data.name, ...(input !== undefined && { input }) }
    }
  }
  return undefined
}

/** The files of a request's `metadata.files`, when there is at least one and every entry is a changed file; else `undefined`. */
export function changedFilesOf(metadata: Record<string, unknown> | undefined): ChangedFile[] | undefined {
  const parsed = z.array(diffEntry).min(1).safeParse(metadata?.files)
  if (!parsed.success) return undefined
  return parsed.data.map(({ file, status, additions, deletions, patch }) => ({
    file,
    status,
    additions,
    deletions,
    patch,
  }))
}
