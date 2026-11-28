import { homedir } from "node:os"
import { isAbsolute, relative, resolve, sep } from "node:path"
import { ToolError } from "../errors"
import { POLICIES, type Policy } from "../role"
import { shown } from "../text"
import type { ToolOptions } from "../tool"
import type { ConsumerRules, Rule } from "./rule"

/** The most characters the `note` setting may hold. */
export const MAX_RUN_NOTE_LENGTH = 2000
/** The most rules the `rules` setting may give one policy. */
export const MAX_CONSUMER_RULES = 100
/** The most characters of a rule's action or resource. */
export const MAX_RULE_TEXT = 500

const RULE_KEYS = ["action", "resource", "effect"]
const EFFECTS: readonly Rule["effect"][] = ["allow", "deny", "ask"]
const CONTROL_CHARACTER = /\p{Cc}/u

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function invalid(message: string): ToolError {
  return new ToolError("invalid_argument", message)
}

/** The `note` setting, trimmed; undefined when unset or blank. Longer than `MAX_RUN_NOTE_LENGTH` is `invalid_argument`. */
export function noteOf(options: ToolOptions | undefined): string | undefined {
  const note: unknown = options?.note
  if (note === undefined) return undefined
  if (typeof note !== "string") throw invalid(`Setting "note" must be text.`)
  const trimmed = note.trim()
  if (trimmed.length > MAX_RUN_NOTE_LENGTH) {
    throw invalid(`Setting "note" is ${trimmed.length} characters; at most ${MAX_RUN_NOTE_LENGTH} are allowed.`)
  }
  return trimmed === "" ? undefined : trimmed
}

function ruleText(value: unknown): value is string {
  return typeof value === "string" && value !== "" && value.length <= MAX_RULE_TEXT && !CONTROL_CHARACTER.test(value)
}

function ruleOf(policy: Policy, position: number, value: unknown): Rule {
  const where = `Setting "rules", policy ${shown(policy)}, rule ${position + 1}`
  if (!isPlainObject(value)) throw invalid(`${where} must be an object with an action, a resource and an effect.`)
  const unknown = Object.keys(value).find((key) => !RULE_KEYS.includes(key))
  if (unknown !== undefined)
    throw invalid(`${where} has an unknown key ${shown(unknown)}; use action, resource or effect.`)
  const { action, resource, effect } = value
  const limits = `non-empty text without control characters, at most ${MAX_RULE_TEXT} characters`
  if (!ruleText(action)) throw invalid(`${where} needs an action of ${limits}.`)
  if (!ruleText(resource)) throw invalid(`${where} needs a resource of ${limits}.`)
  const checkedEffect = EFFECTS.find((candidate) => candidate === effect)
  if (checkedEffect === undefined) throw invalid(`${where} needs an effect of "allow", "deny" or "ask".`)
  return { action, resource, effect: checkedEffect }
}

/** The `rules` setting checked: only the policies' own keys, each a list of at most `MAX_CONSUMER_RULES` rules. Unset gives `{}`. */
export function consumerRulesOf(options: ToolOptions | undefined): ConsumerRules {
  const configured: unknown = options?.rules
  if (configured === undefined) return {}
  if (!isPlainObject(configured)) throw invalid(`Setting "rules" must be an object of rule lists by policy.`)
  const rules: Partial<Record<Policy, readonly Rule[]>> = {}
  for (const [key, list] of Object.entries(configured)) {
    const policy = POLICIES.find((candidate) => candidate === key)
    if (policy === undefined)
      throw invalid(`Setting "rules" has an unknown policy ${shown(key)}; use "read-only" or "write".`)
    if (!Array.isArray(list)) throw invalid(`Setting "rules", policy ${shown(policy)}, must be a list of rules.`)
    if (list.length > MAX_CONSUMER_RULES) {
      throw invalid(
        `Setting "rules", policy ${shown(policy)}, has ${list.length} rules; at most ${MAX_CONSUMER_RULES} are allowed.`,
      )
    }
    rules[policy] = list.map((rule: unknown, position) => ruleOf(policy, position, rule))
  }
  return rules
}

function paths(options: ToolOptions | undefined, name: string): readonly string[] {
  const value: unknown = options?.[name]
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw invalid(`Setting "${name}" must be a list of paths.`)
  }
  return value
}

function holds(root: string, directory: string): boolean {
  const path = relative(resolve(root), resolve(directory))
  return path === "" || !(path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path))
}

/** The `read_roots` setting; a root that is the home directory or holds it is `invalid_argument`, since credentials live there. */
export function readRootsOf(options: ToolOptions | undefined, home: string = homedir()): readonly string[] {
  const roots = paths(options, "read_roots")
  const offending = roots.find((root) => holds(root, home))
  if (offending !== undefined) {
    throw invalid(
      `Setting "read_roots" names ${shown(offending)}, which holds the home directory, where credentials live.`,
    )
  }
  return roots
}

/** The `protected_dirs` setting. */
export function protectedDirsOf(options: ToolOptions | undefined): readonly string[] {
  return paths(options, "protected_dirs")
}
