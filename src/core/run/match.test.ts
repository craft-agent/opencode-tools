import { describe, expect, test } from "bun:test"
import { lastEffect } from "./match"
import type { Rule } from "./rule"

const RULES: Rule[] = [
  { action: "*", resource: "*", effect: "allow" },
  { action: "shell", resource: "git *", effect: "ask" },
  { action: "shell", resource: "git status", effect: "allow" },
  { action: "edit", resource: "*.env", effect: "deny" },
]

describe("lastEffect", () => {
  test("is the effect of the last rule that matches both the action and the resource", () => {
    expect(lastEffect(RULES, "shell", "git push")).toBe("ask")
    expect(lastEffect(RULES, "shell", "git status")).toBe("allow")
    expect(lastEffect(RULES, "edit", "a/b.env")).toBe("deny")
  })

  test("needs the action and the resource to match together", () => {
    expect(lastEffect(RULES, "read", "git push")).toBe("allow")
    expect(lastEffect(RULES, "edit", "notes.txt")).toBe("allow")
    const rules: Rule[] = [{ action: "shell", resource: "git *", effect: "deny" }]
    expect(lastEffect(rules, "shell", "echo hi")).toBeUndefined()
    expect(lastEffect(rules, "edit", "git push")).toBeUndefined()
  })

  test("is undefined when no rule matches, and for no rules at all", () => {
    expect(lastEffect([], "shell", "echo hi")).toBeUndefined()
    expect(lastEffect([{ action: "edit", resource: "*", effect: "ask" }], "shell", "echo hi")).toBeUndefined()
  })

  test("matches a pattern as the service does: the whole value, `*` across `/`, a trailing ` *` optional", () => {
    const rules: Rule[] = [{ action: "shell", resource: "git push *", effect: "deny" }]
    expect(lastEffect(rules, "shell", "git push")).toBe("deny")
    expect(lastEffect(rules, "shell", "git push origin main")).toBe("deny")
    expect(lastEffect(rules, "shell", "git pushed")).toBeUndefined()
  })
})
