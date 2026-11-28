/**
 * Test support for the rulesets of a run: an evaluator that gives a call the
 * strictest effect of its resources, on top of the matcher of `match.ts`. It
 * is for tests only and uses no test runner's API; nothing outside tests may
 * decide by it.
 */
import type { Policy } from "../role"
import { lastEffect } from "./match"
import type { Rule } from "./rule"
import { rulesetOf, type RulesetInput } from "./ruleset"

export { matches, type MatchOptions } from "./match"

/** Both policies, for the tests that hold for each. */
export const POLICIES: readonly Policy[] = ["read-only", "write"]

/** The effect of a call, or of its strictest resource. */
export type Effect = Rule["effect"]

/** One example of a table: the action, the resource (a pipeline's, one per simple command) and the effect the service gives it. */
export type Example = readonly [action: string, resource: string | string[], effect: Effect]

/** The rules of a default agent, which the session's rules follow: allow all, ask for environment files, allow their samples. */
export const AGENT_RULES: readonly Rule[] = [
  { action: "*", resource: "*", effect: "allow" },
  { action: "read", resource: "*.env", effect: "ask" },
  { action: "read", resource: "*.env.*", effect: "ask" },
  { action: "read", resource: "*.env.example", effect: "allow" },
  { action: "question", resource: "*", effect: "allow" },
]

/** What the service evaluates for a run: a default agent's rules, then the run's ruleset built from `input` (empty where it names nothing). */
export function sessionRulesOf(input: Pick<RulesetInput, "policy"> & Partial<RulesetInput>): Rule[] {
  return [...AGENT_RULES, ...rulesetOf({ scratch: [], readRoots: [], rules: [], ...input })]
}

/** How strict an effect is: a call with several resources takes the strictest. */
const STRICTNESS: Readonly<Record<Effect, number>> = { allow: 0, ask: 1, deny: 2 }

/** The effect of a call no rule matches. */
const UNMATCHED: Effect = "ask"

/**
 * The effect the service gives a call: the last rule whose action and
 * resource patterns both match wins, no match asks, and a call with several
 * resources (a pipeline has one per simple command) takes the strictest.
 */
export function effectOf(rules: readonly Rule[], action: string, resources: string | string[]): Effect {
  const effects = (typeof resources === "string" ? [resources] : resources).map(
    (resource) => lastEffect(rules, action, resource) ?? UNMATCHED,
  )
  return effects.reduce<Effect>(
    (strictest, effect) => (STRICTNESS[effect] > STRICTNESS[strictest] ? effect : strictest),
    "allow",
  )
}
