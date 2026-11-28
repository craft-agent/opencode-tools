import { describe, expect, test } from "bun:test"
import { ToolError } from "../errors"
import { NOTE_KEY } from "../run/note"
import { KEY_PREFIX, MAX_ENTRY_NAME, checkKey, isPackageKey, type KeyUse } from "./key"

function refusal(key: string, use: KeyUse): ToolError {
  try {
    checkKey(key, use)
  } catch (error) {
    if (error instanceof ToolError) return error
    throw error
  }
  throw new Error(`Expected ${key} to be refused.`)
}

describe("the prefix", () => {
  test("is the package's metadata key and a dot, which the operating note's key starts with", () => {
    expect(KEY_PREFIX).toBe("opencode-tools.")
    expect(NOTE_KEY.startsWith(KEY_PREFIX)).toBe(true)
    expect(MAX_ENTRY_NAME).toBe(40)
  })

  test("marks the package's entries, whatever follows it", () => {
    expect(isPackageKey("opencode-tools.a")).toBe(true)
    expect(isPackageKey("opencode-tools.a.b.C")).toBe(true)
    expect(isPackageKey("opencode-tools")).toBe(false)
    expect(isPackageKey("other.a")).toBe(false)
  })
})

describe("checkKey", () => {
  test("accepts the prefix and a name of lower-case letters, digits, _ and -, from 1 to 40 characters", () => {
    for (const name of ["a", "0", "a-b_c9", "9lives", "x".repeat(MAX_ENTRY_NAME)]) {
      expect(() => checkKey(`${KEY_PREFIX}${name}`, "write")).not.toThrow()
      expect(() => checkKey(`${KEY_PREFIX}${name}`, "read")).not.toThrow()
    }
  })

  test("refuses any other key as invalid_argument with the reason key, saying the form", () => {
    for (const key of [
      "note",
      "other.note",
      "opencode-tools",
      "opencode-tools.",
      "opencode-tools.Note",
      "opencode-tools.a.b",
      `opencode-tools.${"x".repeat(MAX_ENTRY_NAME + 1)}`,
      "opencode-tools._a",
      "opencode-tools.-a",
      "opencode-tools.a b",
      "opencode-toolsXa",
    ]) {
      for (const use of ["read", "write"] as const) {
        const error = refusal(key, use)
        expect([error.code, error.details]).toEqual(["invalid_argument", { reason: "key" }])
        expect(error.message).toContain("opencode-tools.<name>")
        expect(error.message).toContain("1 to 40")
      }
    }
  })

  test("refuses the operating note for a write as forbidden with the reason reserved, and allows it for a read", () => {
    const error = refusal(NOTE_KEY, "write")
    expect([error.code, error.details]).toEqual(["forbidden", { reason: "reserved" }])
    expect(error.message).toContain("operating note")
    expect(() => checkKey(NOTE_KEY, "read")).not.toThrow()
  })
})
