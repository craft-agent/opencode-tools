import { describe, expect, test } from "bun:test"
import { ToolError } from "../errors"
import type { ToolOptions } from "../tool"
import type { ConsumerRules } from "./rule"
import {
  MAX_CONSUMER_RULES,
  MAX_RULE_TEXT,
  MAX_RUN_NOTE_LENGTH,
  consumerRulesOf,
  noteOf,
  protectedDirsOf,
  readRootsOf,
} from "./options"

const HOME = "/Users/me"
const rule = { action: "bash", resource: "git log *", effect: "allow" }

function invalidWith(run: () => unknown, ...parts: string[]): void {
  let error: unknown
  try {
    run()
  } catch (caught) {
    error = caught
  }
  expect(error).toBeInstanceOf(ToolError)
  expect((error as ToolError).code).toBe("invalid_argument")
  for (const part of parts) expect((error as ToolError).message).toContain(part)
}

describe("noteOf", () => {
  test("is trimmed, and unset or blank is undefined", () => {
    expect(noteOf({ note: "  Be brief.  " })).toBe("Be brief.")
    expect(noteOf({ note: "   " })).toBeUndefined()
    expect(noteOf({})).toBeUndefined()
    expect(noteOf(undefined)).toBeUndefined()
  })

  test("at the limit is accepted, past it refused", () => {
    expect(noteOf({ note: "a".repeat(MAX_RUN_NOTE_LENGTH) })).toHaveLength(MAX_RUN_NOTE_LENGTH)
    invalidWith(() => noteOf({ note: "a".repeat(MAX_RUN_NOTE_LENGTH + 1) }), "note")
  })

  test("text only", () => {
    invalidWith(() => noteOf({ note: 3 }), "note")
  })
})

describe("consumerRulesOf", () => {
  test("unset gives no rules", () => {
    expect(consumerRulesOf(undefined)).toEqual({})
    expect(consumerRulesOf({})).toEqual({})
  })

  test("accepts a list per policy", () => {
    const rules = {
      "read-only": [rule],
      write: [
        { ...rule, effect: "ask" },
        { ...rule, effect: "deny" },
      ],
    }
    expect(consumerRulesOf({ rules } as ToolOptions)).toEqual(rules as ConsumerRules)
    expect(consumerRulesOf({ rules: { write: [] } })).toEqual({ write: [] })
  })

  test("accepts the most rules and the longest text", () => {
    const long = "a".repeat(MAX_RULE_TEXT)
    const full = Array.from({ length: MAX_CONSUMER_RULES }, () => ({ ...rule, resource: long }))
    expect(consumerRulesOf({ rules: { write: full } }).write).toHaveLength(MAX_CONSUMER_RULES)
  })

  test("refuses another policy name", () => {
    invalidWith(() => consumerRulesOf({ rules: { other: [] } }), "rules", "other")
  })

  test("refuses what is not a list of rules", () => {
    invalidWith(() => consumerRulesOf({ rules: { write: "x" } }), "rules", "write")
    invalidWith(() => consumerRulesOf({ rules: { write: ["x"] } }), "rules", "write", "rule 1")
    invalidWith(() => consumerRulesOf({ rules: { write: [[]] } }), "rule 1")
  })

  test("refuses more rules than the limit", () => {
    const rules = Array.from({ length: MAX_CONSUMER_RULES + 1 }, () => rule)
    invalidWith(() => consumerRulesOf({ rules: { write: rules } }), "rules", "write")
  })

  test("names the rule's position", () => {
    invalidWith(
      () => consumerRulesOf({ rules: { "read-only": [rule, { ...rule, effect: "maybe" }] } }),
      "read-only",
      "rule 2",
      "effect",
    )
  })

  test.each([
    ["an unknown key", { ...rule, extra: 1 }, "extra"],
    ["a missing action", { resource: "x", effect: "allow" }, "action"],
    ["a missing resource", { action: "x", effect: "allow" }, "resource"],
    ["a missing effect", { action: "x", resource: "x" }, "effect"],
    ["an empty action", { ...rule, action: "" }, "action"],
    ["an action that is not text", { ...rule, action: 1 }, "action"],
    ["a resource with a control character", { ...rule, resource: "a\nb" }, "resource"],
    ["a resource that is too long", { ...rule, resource: "a".repeat(MAX_RULE_TEXT + 1) }, "resource"],
  ])("refuses %s", (_name, bad, part) => {
    invalidWith(() => consumerRulesOf({ rules: { write: [bad] } }), "rules", part)
  })

  test("refuses what is not an object", () => {
    invalidWith(() => consumerRulesOf({ rules: ["x"] as never }), "rules")
  })
})

describe("readRootsOf", () => {
  test("unset gives none, a list is returned", () => {
    expect(readRootsOf({}, HOME)).toEqual([])
    expect(readRootsOf({ read_roots: ["/srv/docs", "/Users/someone-else"] }, HOME)).toEqual([
      "/srv/docs",
      "/Users/someone-else",
    ])
  })

  test.each(["/", "/Users", HOME, "/Users/me/../me"])("refuses %s, which holds the home directory", (root) => {
    invalidWith(() => readRootsOf({ read_roots: ["/srv/docs", root] }, HOME), "read_roots", "holds the home directory")
  })

  test("a directory inside the home directory is allowed", () => {
    expect(readRootsOf({ read_roots: [`${HOME}/docs`] }, HOME)).toEqual([`${HOME}/docs`])
  })

  test("the home directory defaults to the account's", () => {
    invalidWith(() => readRootsOf({ read_roots: ["/"] }), "holds the home directory")
  })
})

describe("protectedDirsOf", () => {
  test("unset gives none, a list is returned", () => {
    expect(protectedDirsOf(undefined)).toEqual([])
    expect(protectedDirsOf({ protected_dirs: ["/srv/main"] })).toEqual(["/srv/main"])
  })
})
