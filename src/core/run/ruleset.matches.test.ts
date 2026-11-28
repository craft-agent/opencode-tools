import { describe, expect, test } from "bun:test"
import { AGENT_RULES, effectOf, matches } from "./ruleset.testing"

describe("matches", () => {
  test("`*` crosses `/` and newlines", () => {
    expect(matches("*.env", "a/b/c.env")).toBe(true)
    expect(matches("a*b", "a\nb")).toBe(true)
  })

  test("`?` is one character and the whole value must match", () => {
    expect(matches("a?c", "abc")).toBe(true)
    expect(matches("a?c", "abbc")).toBe(false)
    expect(matches("git", "git push")).toBe(false)
  })

  test("a trailing ` *` also matches the text without it", () => {
    expect(matches("git push *", "git push")).toBe(true)
    expect(matches("git push *", "git push origin")).toBe(true)
    expect(matches("git push *", "git pushed")).toBe(false)
  })

  test("regex specials in the pattern are plain text", () => {
    expect(matches("a.b(c)", "a.b(c)")).toBe(true)
    expect(matches("a.b", "axb")).toBe(false)
    expect(matches("[x]+", "[x]+")).toBe(true)
  })

  test("a backslash is a slash in both", () => {
    expect(matches("a/*", "a\\b")).toBe(true)
    expect(matches("a\\*", "a/b")).toBe(true)
  })

  test("case matters unless asked to fold it", () => {
    expect(matches("*.ENV", "a.env")).toBe(false)
    expect(matches("*.ENV", "a.env", { ignoreCase: true })).toBe(true)
  })
})

describe("effectOf", () => {
  test("the last matching rule wins", () => {
    expect(effectOf(AGENT_RULES, "read", ".env")).toBe("ask")
    expect(effectOf(AGENT_RULES, "read", ".env.example")).toBe("allow")
    expect(effectOf(AGENT_RULES, "read", "src/a.ts")).toBe("allow")
  })

  test("no match asks", () => {
    expect(effectOf([], "shell", "ls")).toBe("ask")
  })

  test("several resources take the strictest", () => {
    const rules = [
      ...AGENT_RULES,
      { action: "shell", resource: "b", effect: "ask" as const },
      { action: "shell", resource: "c", effect: "deny" as const },
    ]
    expect(effectOf(rules, "shell", ["a", "b"])).toBe("ask")
    expect(effectOf(rules, "shell", ["a", "b", "c"])).toBe("deny")
  })
})
