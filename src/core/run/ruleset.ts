import type { Policy } from "../role"
import { ACTION, ANY_RESOURCE, EVERY_RUN, READ_ONLY_GIT, WRITE_ASK, rulesOf } from "./patterns"
import type { Rule } from "./rule"

/** What a run's ruleset is built from. */
export type RulesetInput = {
  policy: Policy
  /** Directories the service itself sends a run to, each already in every spelling to allow. */
  scratch: readonly string[]
  /** A read-only run's read roots, each already in every spelling; ignored for a write run. */
  readRoots: readonly string[]
  /** The consumer's rules for this policy. */
  rules: readonly Rule[]
}

/** A path outside the worktree, by its absolute path or by one that climbs out of it. */
const OUTSIDE_THE_WORKTREE = ["/*", "../*"]

/** What a directory's whole content is called in an `external_directory` rule. */
function insideOf(directory: string): string {
  return `${directory}/*`
}

function policyBlock(policy: Policy): Rule[] {
  if (policy === "read-only") {
    return [...rulesOf(ACTION.edit, "deny", [ANY_RESOURCE]), ...rulesOf(ACTION.shell, "deny", READ_ONLY_GIT)]
  }
  return [...rulesOf(ACTION.edit, "deny", OUTSIDE_THE_WORKTREE), ...rulesOf(ACTION.shell, "ask", WRITE_ASK)]
}

/**
 * The session ruleset of a run, in the order the service evaluates it: the
 * last rule that matches wins, so what must hold comes last.
 *
 * 1. A path outside the worktree asks, whatever the agent allows.
 * 2. The narrow allows: the service's own directories, and for a read-only
 *    run its read roots. A write run gets no read roots, since a shell
 *    command's directory is checked under the same rule and a root would let
 *    it work there.
 * 3. The policy's block: a read-only run is denied the edit tools and the git
 *    commands that write; a write run is denied every edit outside its
 *    worktree and asked before it rewrites history.
 * 4. The consumer's rules, which tighten a run or open another package's
 *    tools.
 * 5. What every run is denied, so that nothing before it reopens it.
 *
 * No broad allow is added: the session's rules come after the agent's and
 * reach its subagents, so an allow would reopen what they deny themselves.
 * Pure: the same input gives the same list.
 */
export function rulesetOf(input: RulesetInput): Rule[] {
  const directories = input.policy === "read-only" ? [...input.scratch, ...input.readRoots] : input.scratch
  return [
    ...rulesOf(ACTION.externalDirectory, "ask", [ANY_RESOURCE]),
    ...rulesOf(ACTION.externalDirectory, "allow", directories.map(insideOf)),
    ...policyBlock(input.policy),
    ...input.rules,
    ...EVERY_RUN,
  ]
}
