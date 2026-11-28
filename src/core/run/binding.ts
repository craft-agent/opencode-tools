import { z } from "zod"
import type { JsonValue } from "../errors"

/** The key of the package's own entry in a session's metadata. */
export const BINDING_KEY = "opencode-tools"
/** The version of the binding's shape, which a binding of another version is not read as. */
export const BINDING_VERSION = 1
/** How long a start's mark counts. */
export const STARTING_MS = 60_000

/** A start's mark on its session while it sets it up: when, and a token of that call. */
export type Starting = { at: number; token: string }

/** What binds a session to its caller, its role and the worktree's repository and branch. */
export type Binding = {
  v: 1
  caller: string
  role: string
  /** The real path of the repository's common directory. */
  repository: string
  /** The branch the run is bound to; null on a detached HEAD. */
  branch: string | null
  starting?: Starting
}

const text = z.string().min(1)

const bindingSchema = z.object({
  v: z.literal(BINDING_VERSION),
  caller: text,
  role: text,
  repository: text,
  branch: z.string().nullable(),
  starting: z.object({ at: z.number().finite(), token: text }).optional(),
})

/** The binding in a session's metadata: undefined when there is none, or what is there is not a binding of this version (another shape, another `v`). Never throws. */
export function bindingOf(metadata: unknown): Binding | undefined {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return undefined
  const parsed = bindingSchema.safeParse((metadata as Record<string, unknown>)[BINDING_KEY])
  return parsed.success ? parsed.data : undefined
}

/** The binding as stored: `starting` only when it has one. */
function stored(binding: Binding): Record<string, JsonValue> {
  const { starting, ...rest } = binding
  return starting === undefined ? rest : { ...rest, starting: { ...starting } }
}

/** A session's metadata with the binding set and every other key kept: the service replaces metadata as a whole. */
export function withBinding(
  metadata: Readonly<Record<string, JsonValue>> | undefined,
  binding: Binding,
): Record<string, JsonValue> {
  return { ...metadata, [BINDING_KEY]: stored(binding) }
}

/** Whether two bindings are the same in every field, the mark included. */
export function sameBinding(a: Binding | undefined, b: Binding | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  return (
    a.v === b.v &&
    a.caller === b.caller &&
    a.role === b.role &&
    a.repository === b.repository &&
    a.branch === b.branch &&
    a.starting?.at === b.starting?.at &&
    a.starting?.token === b.starting?.token
  )
}

/** A binding without its mark. */
export function unmarked(binding: Binding): Binding {
  const { starting: _starting, ...rest } = binding
  return rest
}

/** Whether a session is being set up at `now`: marked less than STARTING_MS ago (and not in the future by more than that), and not busy since the mark. */
export function isStarting(binding: Binding | undefined, time: { busy?: number }, now: number): boolean {
  const mark = binding?.starting
  if (mark === undefined) return false
  if (Math.abs(now - mark.at) >= STARTING_MS) return false
  return time.busy === undefined || time.busy < mark.at
}
