import { describe, expect, test } from "bun:test"
import { ToolError } from "../errors"
import { MAX_ACTION_PATTERN, MAX_NEVER_APPROVE, neverApproveOf } from "./options"

function invalidWith(run: () => unknown, message: string): void {
  let error: unknown
  try {
    run()
  } catch (caught) {
    error = caught
  }
  expect(error).toBeInstanceOf(ToolError)
  expect((error as ToolError).code).toBe("invalid_argument")
  expect((error as ToolError).message).toBe(message)
}

describe("neverApproveOf", () => {
  test("unset gives none", () => {
    expect(neverApproveOf(undefined)).toEqual([])
    expect(neverApproveOf({})).toEqual([])
  })

  test("a list is returned trimmed, in order, without duplicates", () => {
    expect(neverApproveOf({ never_approve: ["  bash  ", "edit", "bash", "web*"] })).toEqual(["bash", "edit", "web*"])
  })

  test("accepts the most patterns and the longest pattern", () => {
    const full = Array.from({ length: MAX_NEVER_APPROVE }, (_, index) => `action-${index}`)
    expect(neverApproveOf({ never_approve: full })).toHaveLength(MAX_NEVER_APPROVE)
    const long = "a".repeat(MAX_ACTION_PATTERN)
    expect(neverApproveOf({ never_approve: [long] })).toEqual([long])
  })

  test.each([["text"], [3], [["bash", 1]], [{ a: 1 }]])("refuses %p, which is not a list of text", (value) => {
    invalidWith(
      () => neverApproveOf({ never_approve: value } as never),
      `Setting "never_approve" must be a list of action patterns.`,
    )
  })

  test("refuses more patterns than the limit", () => {
    const patterns = Array.from({ length: MAX_NEVER_APPROVE + 1 }, (_, index) => `action-${index}`)
    invalidWith(
      () => neverApproveOf({ never_approve: patterns }),
      `Setting "never_approve" has 51 patterns; at most 50 are allowed.`,
    )
  })

  test.each([
    ["an empty pattern", ""],
    ["a blank pattern", "   "],
    ["a pattern that is too long", "a".repeat(MAX_ACTION_PATTERN + 1)],
    ["a pattern with a control character", "a\nb"],
  ])("refuses %s, naming its position", (_name, bad) => {
    invalidWith(
      () => neverApproveOf({ never_approve: ["bash", bad] }),
      `Setting "never_approve", pattern 2, must be non-empty text without control characters, at most 200 characters.`,
    )
  })
})
