import { z } from "zod"
import { read } from "./reply"

/** An id a result uses: an empty one names nothing. */
const id = z.string().min(1)

const OUTCOMES = ["succeeded", "failed", "interrupted"] as const

const structuredError = z.looseObject({ type: z.string(), message: z.string() })
const created = z.looseObject({ created: z.number() })

const part = z.looseObject({ type: z.string() })
const textPart = z.looseObject({ text: z.string() })
const toolPart = z.looseObject({ name: z.string(), state: z.looseObject({ status: z.string() }) })

const message = z.looseObject({ type: z.string(), time: created })
const textMessage = z.looseObject({ text: z.string() })
const assistantMessage = z.looseObject({
  time: z.looseObject({ created: z.number(), completed: z.number().optional() }),
  agent: z.string(),
  content: z.array(part),
  error: structuredError.optional(),
  retry: z.looseObject({ attempt: z.number(), at: z.number(), error: structuredError }).optional(),
})
const idleMessage = z.looseObject({ outcome: z.enum(OUTCOMES), error: structuredError.optional() })

const permission = z.looseObject({ id, action: z.string(), resources: z.array(z.string()) })
const form = z.looseObject({ id, title: z.string() })
/** A file a turn changed, with its patch, as a reply carries it. */
export const diffEntry = z.looseObject({
  file: z.string(),
  patch: z.string(),
  additions: z.number(),
  deletions: z.number(),
  status: z.enum(["added", "deleted", "modified"]),
})

/** An error the service structured: its kind and what it says. */
export type StructuredError = z.output<typeof structuredError>

/** A provider call the service is retrying, and when it will try again. */
export type RetryEntry = { attempt: number; at: number; error: StructuredError }

/** A message as the handlers read it; the fields a message of another type does not have are absent. */
export type MessageEntry = {
  type: string
  /** When it was created. */
  created: number
  /** A user, synthetic or system message's text; an assistant's text parts joined by a blank line, absent when it has none. */
  text?: string
  /** An assistant message's time of completion, absent while it is written. */
  completed?: number
  agent?: string
  /** An assistant message's tool parts, in order. */
  tools?: { name: string; status: string }[]
  error?: StructuredError
  retry?: RetryEntry
  /** An idle message's outcome. */
  outcome?: (typeof OUTCOMES)[number]
}

/** A permission request a session is paused on. */
export type PermissionEntry = z.output<typeof permission>
/** A question a session is paused on. */
export type FormEntry = z.output<typeof form>
/** A file a turn changed, with its patch. */
export type DiffEntry = z.output<typeof diffEntry>

const TEXT_TYPES = ["user", "synthetic", "system"]

function assistantEntry(row: unknown, base: { type: string; created: number }): MessageEntry {
  const { time, agent, content, error, retry } = read(assistantMessage, row)
  const texts: string[] = []
  const tools: { name: string; status: string }[] = []
  for (const item of content) {
    if (item.type === "text") texts.push(read(textPart, item).text)
    else if (item.type === "tool") {
      const { name, state } = read(toolPart, item)
      tools.push({ name, status: state.status })
    }
  }
  return {
    ...base,
    agent,
    ...(time.completed !== undefined && { completed: time.completed }),
    ...(texts.length > 0 && { text: texts.join("\n\n") }),
    ...(tools.length > 0 && { tools }),
    ...(error !== undefined && { error: { type: error.type, message: error.message } }),
    ...(retry !== undefined && {
      retry: { attempt: retry.attempt, at: retry.at, error: { type: retry.error.type, message: retry.error.message } },
    }),
  }
}

function messageEntry(row: unknown): MessageEntry {
  const { type, time } = read(message, row)
  const base = { type, created: time.created }
  if (TEXT_TYPES.includes(type)) return { ...base, text: read(textMessage, row).text }
  if (type === "assistant") return assistantEntry(row, base)
  if (type === "idle") {
    const { outcome, error } = read(idleMessage, row)
    return { ...base, outcome, ...(error !== undefined && { error: { type: error.type, message: error.message } }) }
  }
  return base
}

/** The messages of a `message.list` reply, in the order the service gives them. */
export function messagesOf(reply: unknown): MessageEntry[] {
  return read(z.looseObject({ data: z.array(z.unknown()) }), reply).data.map(messageEntry)
}

/** The requests of a `permission.list` reply. */
export function permissionsOf(reply: unknown): PermissionEntry[] {
  return read(z.array(permission), reply)
}

/** The forms of a `session.form.list` reply. */
export function formsOf(reply: unknown): FormEntry[] {
  return read(z.array(form), reply)
}

/** The files of a `session.diff` reply. */
export function diffOf(reply: unknown): DiffEntry[] {
  return read(z.array(diffEntry), reply)
}

/** When the newest item of a `session.inbox.list` reply was created, of the items of `type` when one is given; `undefined` when there is none. */
export function newestInboxOf(reply: unknown, type?: string): number | undefined {
  const times = read(z.array(z.looseObject({ type: z.string().optional(), time: created })), reply)
    .filter((item) => type === undefined || item.type === type)
    .map((item) => item.time.created)
  return times.length === 0 ? undefined : Math.max(...times)
}
