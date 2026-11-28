import { ToolError } from "./errors"
import { shown } from "./text"
import type { ToolOptions } from "./tool"

/** What a run may change. */
export type Policy = "read-only" | "write"

/** A name for an agent and a policy, with an optional model and note. */
export type Role = { agent: string; policy: Policy; model?: string; note?: string }

export type Roles = Readonly<Record<string, Role>>

/** The roles when none are configured. */
export const DEFAULT_ROLES: Roles = {
  plan: { agent: "plan", policy: "read-only" },
  build: { agent: "build", policy: "write" },
}

/** The most roles a setting may name. */
export const MAX_ROLES = 20

const ROLE_NAME_PATTERN = /^[a-z][a-z0-9_]{0,23}$/
const MAX_NOTE_LENGTH = 2000
const ROLE_KEYS = ["agent", "policy", "model", "note"]
const POLICIES: readonly Policy[] = ["read-only", "write"]
const VARIANT_SEPARATOR = "#"
const PROVIDER_SEPARATOR = "/"

/**
 * The parts of a model written `<provider>/<model>` with an optional
 * `#<variant>`; `undefined` when the text is not written so. It splits as
 * OpenCode does: the provider is what comes before the first `/` (it may hold
 * a `#`), the model what follows up to the first `#` after that slash, and the
 * variant everything after that `#`, further `#` included.
 */
export function parseModel(text: string): { providerID: string; modelID: string; variant?: string } | undefined {
  const trimmed = text.trim()
  if (/\s/.test(trimmed)) return undefined
  const slash = trimmed.indexOf(PROVIDER_SEPARATOR)
  if (slash === -1) return undefined
  const providerID = trimmed.slice(0, slash)
  const rest = trimmed.slice(slash + 1)
  const hash = rest.indexOf(VARIANT_SEPARATOR)
  const modelID = hash === -1 ? rest : rest.slice(0, hash)
  const variant = hash === -1 ? undefined : rest.slice(hash + 1)
  if (providerID === "" || modelID === "" || variant === "") return undefined
  return { providerID, modelID, ...(variant !== undefined && { variant }) }
}

/** The variant that means no variant. */
export const VARIANT_DEFAULT = "default"

/** A model written `<provider>/<model>`, with `#<variant>` when it has a variant that is not `default`: the inverse of `parseModel`. */
export function modelText(ref: { providerID: string; id: string; variant?: string }): string {
  const path = `${ref.providerID}${PROVIDER_SEPARATOR}${ref.id}`
  return ref.variant === undefined || ref.variant === VARIANT_DEFAULT
    ? path
    : `${path}${VARIANT_SEPARATOR}${ref.variant}`
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function invalid(message: string): ToolError {
  return new ToolError("invalid_argument", message)
}

function roleOf(name: string, value: unknown): Role {
  const label = shown(name)
  if (!ROLE_NAME_PATTERN.test(name)) {
    throw invalid(
      `Role name ${label} must be a lowercase letter followed by at most 23 lowercase letters, digits or underscores.`,
    )
  }
  if (!isPlainObject(value)) throw invalid(`Role ${label} must be an object with an agent and a policy.`)
  const unknown = Object.keys(value).find((key) => !ROLE_KEYS.includes(key))
  if (unknown !== undefined) {
    throw invalid(`Role ${label} has an unknown key ${shown(unknown)}; use agent, policy, model or note.`)
  }
  const { agent, policy, model, note } = value
  if (typeof agent !== "string" || agent.trim() === "") throw invalid(`Role ${label} needs an agent.`)
  const checkedPolicy = POLICIES.find((candidate) => candidate === policy)
  if (checkedPolicy === undefined) throw invalid(`Role ${label} needs a policy of "read-only" or "write".`)
  if (model !== undefined && (typeof model !== "string" || parseModel(model) === undefined)) {
    throw invalid(`Role ${label} has a model that is not written <provider>/<model> or <provider>/<model>#<variant>.`)
  }
  if (note !== undefined && (typeof note !== "string" || note.length > MAX_NOTE_LENGTH)) {
    throw invalid(`Role ${label} has a note that is not text of at most ${MAX_NOTE_LENGTH} characters.`)
  }
  const trimmedNote = typeof note === "string" ? note.trim() : ""
  return {
    agent: agent.trim(),
    policy: checkedPolicy,
    ...(typeof model === "string" && { model: model.trim() }),
    ...(trimmedNote !== "" && { note: trimmedNote }),
  }
}

/** The roles the `roles` option configures, else `DEFAULT_ROLES`; a role that breaks the shape is `invalid_argument` naming it. */
export function rolesOf(options: ToolOptions | undefined): Roles {
  const configured: unknown = options?.roles
  if (configured === undefined) return copyOfDefaults()
  if (!isPlainObject(configured)) throw invalid(`Setting "roles" must be an object of roles by name.`)
  const entries = Object.entries(configured)
  if (entries.length === 0) return copyOfDefaults()
  if (entries.length > MAX_ROLES) {
    throw invalid(`Setting "roles" names ${entries.length} roles; at most ${MAX_ROLES} are allowed.`)
  }
  return withoutPrototype(entries.map(([name, value]) => [name, roleOf(name, value)]))
}

function copyOfDefaults(): Roles {
  return withoutPrototype(Object.entries(DEFAULT_ROLES).map(([name, role]) => [name, { ...role }]))
}

/** The entries as an object with no prototype, so an unconfigured name such as `constructor` is not a role. */
function withoutPrototype(entries: [string, Role][]): Roles {
  const roles: Record<string, Role> = Object.create(null)
  for (const [name, role] of entries) roles[name] = role
  return roles
}
