import { describe, expect, test } from "bun:test"
import { EVERY_RUN } from "./patterns"
import type { Rule } from "./rule"
import { rulesetOf } from "./ruleset"
import { POLICIES, effectOf, sessionRulesOf } from "./ruleset.testing"

const SAMPLE_FILES = ["*.env.example", "*.env.sample", "*.env.template"]
const MAX_READ_ONLY_RULES = 400
const MAX_READ_ONLY_JSON_LENGTH = 40_000

describe.each(POLICIES)("the consumer's rules: %s", (policy) => {
  test("an added deny holds", () => {
    const rules = sessionRulesOf({ policy, rules: [{ action: "shell", resource: "*docker *", effect: "deny" }] })
    expect(effectOf(rules, "shell", "docker run x")).toBe("deny")
    expect(effectOf(rules, "shell", "ls")).toBe("allow")
  })

  test("an added allow for another package's tool holds", () => {
    const rules = sessionRulesOf({ policy, rules: [{ action: "other_tool_*", resource: "*", effect: "allow" }] })
    expect(effectOf(rules, "other_tool_send", "*")).toBe("allow")
  })

  test("an added rule can tighten what a policy asks", () => {
    const rules = sessionRulesOf({ policy, rules: [{ action: "shell", resource: "*npx *", effect: "deny" }] })
    expect(effectOf(rules, "shell", "npx cowsay hi")).toBe("deny")
  })

  test("an added allow does not reopen what every run is denied", () => {
    const reopening: Rule[] = [
      { action: "shell", resource: "*git push*", effect: "allow" },
      { action: "read", resource: "*.env", effect: "allow" },
      { action: "edit", resource: ".git/*", effect: "allow" },
      { action: "*", resource: "*", effect: "allow" },
    ]
    const rules = sessionRulesOf({ policy, rules: reopening })
    expect(effectOf(rules, "shell", "git push")).toBe("deny")
    expect(effectOf(rules, "read", ".env")).toBe("deny")
    expect(effectOf(rules, "edit", ".git/config")).toBe("deny")
    expect(effectOf(rules, "opencode_session_move", "*")).toBe("deny")
  })

  test("the consumer's rules come as given, before what every run is denied", () => {
    const given: Rule[] = [
      { action: "a", resource: "1", effect: "ask" },
      { action: "b", resource: "2", effect: "deny" },
    ]
    const rules = rulesetOf({ policy, scratch: [], readRoots: [], rules: given })
    const start = rules.findIndex((rule) => rule === given[0])
    expect(rules.slice(start, start + given.length)).toEqual(given)
    expect(rules.slice(start + given.length)).toEqual([...EVERY_RUN])
  })
})

describe("a pipeline", () => {
  test("takes the strictest of its commands", () => {
    for (const policy of POLICIES) {
      const rules = sessionRulesOf({ policy })
      expect(effectOf(rules, "shell", ["echo x", "git push", "wc -c"])).toBe("deny")
      expect(effectOf(rules, "shell", ["echo x", "wc -c"])).toBe("allow")
    }
  })

  test("asks when one command asks and none is denied", () => {
    const rules = sessionRulesOf({ policy: "write" })
    expect(effectOf(rules, "shell", ["echo x", "git rebase main"])).toBe("ask")
  })
})

describe("the shape of a ruleset", () => {
  const input = {
    scratch: ["/var/scratch", "/private/var/scratch"],
    readRoots: ["/srv/docs", "/private/srv/docs"],
    rules: [] as Rule[],
  }

  test.each(POLICIES)("%s: the builder allows only the narrow directories and the sample files", (policy) => {
    const allowed = rulesetOf({ ...input, policy })
      .filter((rule) => rule.effect === "allow")
      .map((rule) => `${rule.action} ${rule.resource}`)
    const directories = policy === "read-only" ? [...input.scratch, ...input.readRoots] : input.scratch
    expect(allowed).toEqual([
      ...directories.map((directory) => `external_directory ${directory}/*`),
      ...SAMPLE_FILES.map((sample) => `read ${sample}`),
    ])
  })

  test.each(POLICIES)("%s: every rule has an action, a resource and an effect", (policy) => {
    for (const rule of rulesetOf({ ...input, policy })) {
      expect(rule.action).not.toBe("")
      expect(rule.resource).not.toBe("")
      expect(["allow", "ask", "deny"]).toContain(rule.effect)
    }
  })

  test.each(POLICIES)("%s: the same input gives the same list", (policy) => {
    expect(rulesetOf({ ...input, policy })).toEqual(rulesetOf({ ...input, policy }))
  })

  test.each(POLICIES)("%s: it starts by asking outside and ends with what every run is denied", (policy) => {
    const rules = rulesetOf({ ...input, policy })
    expect(rules[0]).toEqual({ action: "external_directory", resource: "*", effect: "ask" })
    expect(rules.slice(-EVERY_RUN.length)).toEqual([...EVERY_RUN])
  })

  test("a write run ignores read roots", () => {
    expect(rulesetOf({ ...input, policy: "write" })).toEqual(rulesetOf({ ...input, policy: "write", readRoots: [] }))
  })

  test("a read-only ruleset stays small", () => {
    const rules = rulesetOf({ policy: "read-only", scratch: [], readRoots: [], rules: [] })
    expect(rules.length).toBeLessThanOrEqual(MAX_READ_ONLY_RULES)
    expect(JSON.stringify(rules).length).toBeLessThanOrEqual(MAX_READ_ONLY_JSON_LENGTH)
  })
})
