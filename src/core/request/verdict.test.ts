import { describe, expect, test } from "bun:test"
import type { Rule } from "../run/rule"
import {
  DECLINE_ONLY_KIND,
  DECLINE_ONLY_LINK,
  REJECT_ONLY_WORDS,
  declineOnlyOf,
  rejectOnlyOf,
  type VerdictContext,
  type VerdictRequest,
} from "./verdict"
import { MAX_APPROVAL_TEXT } from "./text"

const NO_CONTEXT: VerdictContext = { neverApprove: [], rules: [] }
const ASK_SHELL: Rule[] = [
  { action: "*", resource: "*", effect: "allow" },
  { action: "shell", resource: "git switch *", effect: "ask" },
]

function request(overrides: Partial<VerdictRequest> = {}): VerdictRequest {
  return { action: "shell", resources: ["echo hi"], text: "echo hi", subagent: false, ...overrides }
}

describe("the words", () => {
  test("say each reason a request can only be rejected", () => {
    expect(REJECT_ONLY_WORDS).toEqual({
      never_approve: "The `never_approve` setting holds its action.",
      subagent_ask: "A subagent asked for what the run's own rules ask about.",
      unshowable: "Its text holds characters that cannot be shown as they are.",
      too_long: "Its text is over 2000 characters, more than an approval can show.",
    })
  })
})

describe("rejectOnlyOf", () => {
  test("is undefined for a request that can be approved", () => {
    expect(rejectOnlyOf(request(), NO_CONTEXT)).toBeUndefined()
  })

  test("never_approve: an action pattern of the setting matches the action as a whole", () => {
    const context = { ...NO_CONTEXT, neverApprove: ["edit", "mcp_*"] }
    expect(rejectOnlyOf(request({ action: "edit" }), context)).toBe("never_approve")
    expect(rejectOnlyOf(request({ action: "mcp_run" }), context)).toBe("never_approve")
    expect(rejectOnlyOf(request({ action: "editor" }), context)).toBeUndefined()
    expect(rejectOnlyOf(request({ action: "shell", text: "edit" }), context)).toBeUndefined()
  })

  test("subagent_ask: a subagent's request the run's own rules ask about", () => {
    const context = { ...NO_CONTEXT, rules: ASK_SHELL }
    expect(rejectOnlyOf(request({ subagent: true, resources: ["git switch -c topic"] }), context)).toBe("subagent_ask")
    expect(rejectOnlyOf(request({ subagent: true, resources: ["echo hi", "git switch -c topic"] }), context)).toBe(
      "subagent_ask",
    )
  })

  test("the run's own request under an ask rule stays approvable", () => {
    const context = { ...NO_CONTEXT, rules: ASK_SHELL }
    expect(rejectOnlyOf(request({ resources: ["git switch -c topic"] }), context)).toBeUndefined()
  })

  test("a subagent's request that the rules allow, or that no rule matches, stays approvable", () => {
    const context = { ...NO_CONTEXT, rules: ASK_SHELL }
    expect(rejectOnlyOf(request({ subagent: true, resources: ["echo hi"] }), context)).toBeUndefined()
    const unmatched = { ...NO_CONTEXT, rules: [{ action: "edit", resource: "*", effect: "ask" as const }] }
    expect(rejectOnlyOf(request({ subagent: true }), unmatched)).toBeUndefined()
    expect(rejectOnlyOf(request({ subagent: true }), NO_CONTEXT)).toBeUndefined()
  })

  test("a subagent's request to work outside the worktree stays approvable, since every run asks there", () => {
    const rules: Rule[] = [{ action: "external_directory", resource: "*", effect: "ask" }]
    const asked = request({
      action: "external_directory",
      resources: ["/srv/docs/*"],
      text: "/srv/docs/*",
      subagent: true,
    })
    expect(rejectOnlyOf(asked, { ...NO_CONTEXT, rules })).toBeUndefined()
  })

  test("a subagent's request that names no resource is checked against `*`", () => {
    const rules: Rule[] = [{ action: "mcp_run", resource: "*", effect: "ask" }]
    const asked = request({ action: "mcp_run", resources: [], text: "", subagent: true })
    expect(rejectOnlyOf(asked, { ...NO_CONTEXT, rules })).toBe("subagent_ask")
    expect(rejectOnlyOf({ ...asked, subagent: false }, { ...NO_CONTEXT, rules })).toBeUndefined()
  })

  test("unshowable: a text with a character that cannot be shown as it is", () => {
    expect(rejectOnlyOf(request({ text: "echo\u202ehi" }), NO_CONTEXT)).toBe("unshowable")
    expect(rejectOnlyOf(request({ text: "echo hi\r\n" }), NO_CONTEXT)).toBe("unshowable")
    expect(rejectOnlyOf(request({ text: "echo hi\n\techo ho" }), NO_CONTEXT)).toBeUndefined()
  })

  test("too_long: a text over MAX_APPROVAL_TEXT code points, counted as code points", () => {
    expect(rejectOnlyOf(request({ text: "a".repeat(MAX_APPROVAL_TEXT) }), NO_CONTEXT)).toBeUndefined()
    expect(rejectOnlyOf(request({ text: "a".repeat(MAX_APPROVAL_TEXT + 1) }), NO_CONTEXT)).toBe("too_long")
    expect(rejectOnlyOf(request({ text: "🙂".repeat(MAX_APPROVAL_TEXT) }), NO_CONTEXT)).toBeUndefined()
  })

  test("gives the first reason that holds, in the order of the words", () => {
    const text = `a\u202e${"a".repeat(MAX_APPROVAL_TEXT)}`
    const all = request({ action: "shell", resources: ["git switch -c topic"], text, subagent: true })
    const context = { neverApprove: ["shell"], rules: ASK_SHELL }
    expect(rejectOnlyOf(all, context)).toBe("never_approve")
    expect(rejectOnlyOf(all, { ...context, neverApprove: [] })).toBe("subagent_ask")
    expect(rejectOnlyOf({ ...all, subagent: false }, { ...context, neverApprove: [] })).toBe("unshowable")
    expect(rejectOnlyOf({ ...all, subagent: false, text: "a".repeat(MAX_APPROVAL_TEXT + 1) }, NO_CONTEXT)).toBe(
      "too_long",
    )
  })
})

describe("declineOnlyOf", () => {
  test("is undefined for fields of the six known kinds", () => {
    const fields = ["string", "number", "integer", "boolean", "multiselect"].map((type) => ({ key: type, type }))
    expect(declineOnlyOf(fields)).toBeUndefined()
  })

  test("says a link when a field is one to visit, before it says an unknown kind", () => {
    expect(
      declineOnlyOf([
        { key: "a", type: "string" },
        { key: "l", type: "external" },
      ]),
    ).toBe(DECLINE_ONLY_LINK)
    expect(
      declineOnlyOf([
        { key: "d", type: "date" },
        { key: "l", type: "external" },
      ]),
    ).toBe(DECLINE_ONLY_LINK)
  })

  test("says an unknown kind for a field of another type", () => {
    expect(declineOnlyOf([{ key: "d", type: "date" }])).toBe(DECLINE_ONLY_KIND)
  })

  test("treats a key an answer could not repeat as an unknown kind", () => {
    expect(declineOnlyOf([{ key: "k".repeat(201), type: "string" }])).toBe(DECLINE_ONLY_KIND)
    expect(declineOnlyOf([{ key: "k\u202e", type: "string" }])).toBe(DECLINE_ONLY_KIND)
  })

  test("says its reasons in these words", () => {
    expect(DECLINE_ONLY_LINK).toBe("It has a link to visit, which no tool has visited.")
    expect(DECLINE_ONLY_KIND).toBe("It has a field of a kind these tools do not know.")
  })
})
