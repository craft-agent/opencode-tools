import { describe, expect, test } from "bun:test"
import { UNSAFE_CHARACTERS, shown } from "./text"

describe("shown", () => {
  test("quotes plain text", () => {
    expect(shown("plain text")).toBe('"plain text"')
    expect(shown('say "hi"')).toBe('"say \\"hi\\""')
    expect(shown("")).toBe('""')
  })

  test("escapes a newline, U+202E and U+2028, so nothing moves or reorders text", () => {
    const result = shown("a\nb\u202ec\u2028d")
    expect(result).toBe('"a\\nb\\u202ec\\u2028d"')
    expect(result).not.toMatch(/[\n\u202e\u2028]/)
  })

  test("escapes every character the pattern names, whichever form JSON leaves it in", () => {
    const characters = [
      "\u0000",
      "\u001b",
      "\u007f",
      "\u0085",
      "\u061c",
      "\u2029",
      "\u200e",
      "\u200f",
      "\u202a",
      "\u2066",
      "\u2069",
      "\ufeff",
    ]
    for (const character of characters) {
      const result = shown(`x${character}y`)
      expect(result.replace(UNSAFE_CHARACTERS, "")).toBe(result)
      expect(result.startsWith('"x')).toBe(true)
      expect(result.endsWith('y"')).toBe(true)
    }
    expect(shown("\u007f")).toBe('"\\u007f"')
    expect(shown("a\u061cb")).toBe('"a\\u061cb"')
  })

  test("cuts to the first 40 code points by default, and to the limit given", () => {
    expect(shown("a".repeat(60))).toBe(`"${"a".repeat(40)}"`)
    expect(shown("a".repeat(400), 300)).toBe(`"${"a".repeat(300)}"`)
    expect(shown("abcdef", 3)).toBe('"abc"')
  })

  test("does not split a surrogate pair", () => {
    expect(shown("😀".repeat(5), 3)).toBe(`"${"😀".repeat(3)}"`)
    expect(shown(`${"a".repeat(39)}😀😀`)).toBe(`"${"a".repeat(39)}😀"`)
  })
})
